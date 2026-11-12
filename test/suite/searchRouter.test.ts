// SearchRouter (S3): роутинг запроса, склейка выдачи, crc32 для свежих файлов.
// Интеграция проверяется через настоящий инструмент `search_files` с мок-индексом.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  classifyQuery,
  mergeHits,
  needsMerge,
  MIN_FUZZY_HITS,
} from '../../src/shared/SearchRouter';
import { crc32, SearchIndexer } from '../../src/shared/SearchIndexer';
import { SearchIndexStore } from '../../src/shared/SearchIndex';
import { createTools, setIndexSearchProvider } from '../../src/modes/apply/ToolDefinitions';

async function loadSqlite(): Promise<any> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const mod = await dynamicImport('@sqlite.org/sqlite-wasm');
  return typeof mod.default === 'function' ? await mod.default() : mod;
}

suite('SearchRouter / S3', () => {
  test('IDX-7: идентификатор и regex уходят в точный поиск', () => {
    for (const query of ['calculateCost', 'PROMPT_EVAL_COUNT', 'foo(', '^export', 'src/shared/x.ts', 'run(']) {
      assert.strictEqual(classifyQuery(query), 'exact', `«${query}» должен идти в точный поиск`);
    }
  });

  test('IDX-8: естественный язык уходит в лексический индекс', () => {
    for (const query of ['где считается стоимость прогона', 'как работает лимит бюджета', 'найди прогноз стоимости']) {
      assert.strictEqual(classifyQuery(query), 'fuzzy', `«${query}» должен идти в индекс`);
    }
    assert.strictEqual(classifyQuery(''), 'exact', 'пустой запрос — прежний путь');
    // Одно русское слово — это термин, а не идентификатор: ищем по смыслу
    assert.strictEqual(classifyQuery('налог'), 'fuzzy', 'кириллическое слово уходит в индекс');
    assert.strictEqual(classifyQuery('calculateCost'), 'exact', 'латинский идентификатор — в точный поиск');
  });

  test('IDX-20: склейка ставит точные совпадения выше и убирает дубли', () => {
    const exact = [
      { path: 'src/cost.ts', snippet: 'src/cost.ts:12: calculateCost()' },
      { path: 'src/other.ts', snippet: 'src/other.ts:3: total' },
    ];
    const fuzzy = [
      { path: 'src/other.ts', rank: -1.2, snippet: 'дубль' },
      { path: 'src/budget.ts', rank: -0.5, snippet: 'лимит бюджета' },
    ];

    const merged = mergeHits(exact, fuzzy);
    assert.deepStrictEqual(merged.map((hit) => hit.path), ['src/cost.ts', 'src/other.ts', 'src/budget.ts']);
    assert.strictEqual(merged[1].source, 'exact', 'дубль остался точным, а не превратился в индексный');
    assert.strictEqual(merged[2].source, 'fuzzy');

    assert.strictEqual(needsMerge([{ path: 'a', rank: -1 }]), true, 'одного попадания мало');
    assert.strictEqual(
      needsMerge(Array.from({ length: MIN_FUZZY_HITS }, (_, i) => ({ path: `f${i}`, rank: -1 }))),
      false,
      'достаточная выдача не требует склейки',
    );
  });

  suite('интеграция search_files', () => {
    let sb: sinon.SinonSandbox;

    setup(() => {
      sb = sinon.createSandbox();
    });

    teardown(() => {
      setIndexSearchProvider(undefined);
      sb.restore();
    });

    function stubExactSearch(root: string): void {
      sb.stub(vscode.workspace, 'findFiles').resolves([vscode.Uri.file(`${root}/src/cost.ts`)]);
      sb.stub(vscode.workspace.fs, 'readFile').callsFake(async (uri: vscode.Uri) => {
        if (uri.fsPath.endsWith('.gitignore')) return new TextEncoder().encode('');
        return new TextEncoder().encode('export function calculateCost() { return 0; }\n');
      });
      // FileStat целиком: индекс читает size и mtime, остальные поля для интерфейса
      sb.stub(vscode.workspace.fs, 'stat').resolves({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 100,
      });
    }

    test('IDX-9: запрос языком берёт выдачу из индекса, идентификатор — нет', async () => {
      const root = '/fake/workspace';
      stubExactSearch(root);
      const calls: string[] = [];
      setIndexSearchProvider({
        search: (query: string) => {
          calls.push(query);
          return [
            { path: 'src/budget.ts', rank: -1.5, snippet: 'лимит бюджета сессии', matched: 3 },
            { path: 'src/router.ts', rank: -1.1, snippet: 'прогноз стоимости', matched: 2 },
            { path: 'src/cost.ts', rank: -0.9, snippet: 'calculateCost', matched: 2 },
          ];
        },
      });

      const tool = createTools().find((t) => t.name === 'search_files')!;
      const fuzzyOut = await tool.execute({ pattern: 'где считается стоимость прогона' });
      assert.strictEqual(calls.length, 1, 'индекс спрошен один раз');
      assert.ok(fuzzyOut.includes('(лексический индекс)'), `выдача помечена как индексная: ${fuzzyOut}`);
      assert.ok(fuzzyOut.includes('src/budget.ts'), 'в выдаче есть файл из индекса');

      const exactOut = await tool.execute({ pattern: 'calculateCost' });
      assert.strictEqual(calls.length, 1, 'для идентификатора индекс не дёргается');
      assert.ok(!exactOut.includes('(лексический индекс)'), 'точный поиск работает как раньше');
    });

    test('IDX-34: попадание без счёта совпавших слов не считается ответом', async () => {
      // Провайдер без поля matched — это доверие на слово: раньше undefined пропускался,
      // и шум снова уходил агенту (замечание ревью)
      const root = '/fake/workspace';
      stubExactSearch(root);
      setIndexSearchProvider({ search: () => [{ path: 'src/unknown.ts', rank: -3, snippet: 'что-то' }] });

      const tool = createTools().find((t) => t.name === 'search_files')!;
      const out = await tool.execute({ pattern: 'где хранится индекс кодовой базы' });
      assert.ok(!out.includes('src/unknown.ts'), `попадание без matched не должно выдаваться: ${out}`);
    });

    test('IDX-32: слабые попадания индекса не выдаются как ответ', async () => {
      // Замер: BM25 отдаёт непустую выдачу всегда, поэтому на вопрос без ответа в коде
      // агент получал посторонний файл с 0–1 совпавшим словом (проверено на 5 негативных).
      const root = '/fake/workspace';
      stubExactSearch(root);
      const provider = (hits: Array<{ path: string; rank: number; snippet?: string; matched?: number }>) => {
        setIndexSearchProvider({ search: () => hits });
      };

      // Все попадания слабые (1 и 0 совпавших слов) — ответа нет, и это должно быть видно
      provider([
        { path: 'scripts/check-bundle-loads.js', rank: -5.9, snippet: 'bundle', matched: 0 },
        { path: 'src/providers/ollama.ts', rank: -4.1, snippet: 'ollama', matched: 1 },
      ]);
      const tool = createTools().find((t) => t.name === 'search_files')!;
      const weak = await tool.execute({ pattern: 'где экспортируется отчёт в PDF для агента' });
      assert.ok(
        !weak.includes('(лексический индекс)'),
        `слабые попадания не должны выдаваться как индексный ответ: ${weak}`,
      );

      // Одно сильное попадание среди слабых — выдаётся только оно
      provider([
        { path: 'scripts/check-bundle-loads.js', rank: -9.9, snippet: 'bundle', matched: 0 },
        { path: 'src/shared/SearchIndex.ts', rank: -2.0, snippet: 'индекс', matched: 3 },
      ]);
      const strong = await tool.execute({ pattern: 'где хранится индекс кодовой базы' });
      assert.ok(strong.includes('src/shared/SearchIndex.ts'), `сильное попадание остаётся: ${strong}`);
      assert.ok(!strong.includes('check-bundle-loads'), `слабое попадание отсечено: ${strong}`);
    });

    test('IDX-23: дубль между абсолютным и относительным путём схлопывается', async () => {
      const root = '/fake/workspace';
      stubExactSearch(root);
      // Индекс отдаёт относительный путь того же файла, что нашёлся точным поиском
      setIndexSearchProvider({
        search: () => [{ path: 'src/cost.ts', rank: -1.2, snippet: 'calculateCost', matched: 2 }],
      });

      const tool = createTools().find((t) => t.name === 'search_files')!;
      const out = await tool.execute({ pattern: 'где считается стоимость' });

      assert.ok(out.includes('(точные + индекс)'), `склейка: ${out}`);
      const occurrences = out.split('cost.ts').length - 1;
      assert.strictEqual(occurrences, 1, `один и тот же файл не дублируется разными формами пути: ${out}`);
    });

    test('IDX-21: слабая лексическая выдача склеивается с точной без дублей', async () => {
      const root = '/fake/workspace';
      stubExactSearch(root);
      setIndexSearchProvider({
        search: () => [{ path: 'src/cost.ts', rank: -1.0, snippet: 'дубль пути', matched: 2 }],
      });

      const tool = createTools().find((t) => t.name === 'search_files')!;
      const out = await tool.execute({ pattern: 'где считается стоимость' });

      assert.ok(out.includes('(точные + индекс)'), `пометка о склейке: ${out}`);
      const occurrences = out.split('src/cost.ts').length - 1;
      assert.strictEqual(occurrences, 1, `путь не дублируется: ${out}`);
    });
  });

  test('IDX-19: свежий файл с той же длиной ловится по crc32 при сверке', async function () {
    this.timeout(120000);
    const sqlite3 = await loadSqlite();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-crc-'));
    try {
      const file = path.join(tmp, 'a.ts');
      fs.writeFileSync(file, 'версия один');
      const store = new SearchIndexStore(sqlite3, { indexPath: path.join(tmp, '.index', 'ws.sqlite') });
      await store.init();

      const adapter = {
        listFiles: async () => {
          const stat = fs.statSync(file);
          return [{ relPath: 'a.ts', size: stat.size, mtime: Math.round(stat.mtimeMs) }];
        },
        readFile: async () => new Uint8Array(fs.readFileSync(file)),
      };
      const indexer = new SearchIndexer(store, adapter, {});
      await indexer.fullBuild();
      assert.strictEqual(store.search('версия').length, 1);

      // Правка той же длины: size и mtime могут совпасть, содержимое — нет
      fs.writeFileSync(file, 'версия два!');
      const stats = await indexer.reconcile();
      assert.strictEqual(stats.indexed, 1, 'изменение поймано сверкой');
      assert.strictEqual(store.search('два').length, 1, 'в индексе новая версия');

      assert.strictEqual(crc32(new TextEncoder().encode('abc')), crc32(new TextEncoder().encode('abc')), 'crc стабилен');
      assert.notStrictEqual(crc32(new TextEncoder().encode('abc')), crc32(new TextEncoder().encode('abd')), 'crc различает байты');
      store.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
