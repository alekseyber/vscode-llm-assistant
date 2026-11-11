// Тесты SearchIndexer (S2): обход, фильтры, детект не-текста, пачки, инкремент, сверка.
// ФС — настоящая (временный каталог), SQLite — настоящий (WASM), vscode не нужен.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SearchIndexStore } from '../../src/shared/SearchIndex';
import {
  decodeIndexableText,
  IndexFsAdapter,
  IndexSourceFile,
  parseGitignore,
  SearchIndexer,
  skipReason,
} from '../../src/shared/SearchIndexer';

async function loadSqlite(): Promise<any> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const mod = await dynamicImport('@sqlite.org/sqlite-wasm');
  return typeof mod.default === 'function' ? await mod.default() : mod;
}

/** Адаптер поверх настоящего диска: то же поведение, что у обёртки над vscode.workspace.fs. */
function diskAdapter(root: string): IndexFsAdapter {
  return {
    async listFiles(): Promise<IndexSourceFile[]> {
      const out: IndexSourceFile[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(abs);
            continue;
          }
          if (!entry.isFile()) continue;
          const stat = fs.statSync(abs);
          out.push({ relPath: path.relative(root, abs).replace(/\\/g, '/'), size: stat.size, mtime: Math.round(stat.mtimeMs) });
        }
      };
      walk(root);
      return out;
    },
    async readFile(relPath: string): Promise<Uint8Array> {
      return new Uint8Array(fs.readFileSync(path.join(root, relPath)));
    },
    async readGitignore(): Promise<string[]> {
      const file = path.join(root, '.gitignore');
      if (!fs.existsSync(file)) return [];
      return parseGitignore(fs.readFileSync(file, 'utf-8'));
    },
  };
}

suite('SearchIndexer / S2', () => {
  let sqlite3: any;
  let tmpRoot: string;
  let store: SearchIndexStore;
  let indexPath: string;

  suiteSetup(async function () {
    this.timeout(120000);
    sqlite3 = await loadSqlite();
  });

  setup(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-idx-build-'));
    indexPath = path.join(tmpRoot, '.index', 'ws.sqlite');
    store = new SearchIndexStore(sqlite3, { indexPath });
    await store.init();
  });

  teardown(() => {
    store.close();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* мимо */
    }
  });

  function write(relPath: string, content: string | Buffer): void {
    const abs = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  test('IDX-4: полная сборка обходит каталоги, применяет фильтры и .gitignore', async function () {
    this.timeout(60000);
    write('.gitignore', 'secret/\n*.log\n');
    for (let i = 0; i < 120; i += 1) {
      write(`src/module${i % 7}/file${i}.ts`, `export function handler${i}() { return "стоимость ${i}"; }`);
    }
    write('src/ignored.log', 'мусорный лог');
    write('src/secret/hidden.ts', 'секрет');
    write('node_modules/pkg/index.ts', 'зависимость');
    write('assets/bundle.min.js', 'var a=1;');
    write('README.md', 'документация проекта');

    const indexer = new SearchIndexer(store, diskAdapter(tmpRoot), { batchSize: 25 });
    const stats = await indexer.fullBuild();

    // 120 + README = 121; мусор не попал
    assert.strictEqual(stats.indexed, 121, `проиндексировано файлов: ${stats.indexed}`);
    assert.ok(stats.skipped >= 4, `пропуски посчитаны: ${JSON.stringify(stats.reasons)}`);
    assert.ok(stats.reasons['.gitignore'] >= 1, '.gitignore учтён');
    assert.ok(stats.reasons['каталог'] >= 1, 'node_modules отброшен по каталогу');
    assert.strictEqual(store.search('стоимость').length > 0, true, 'поиск по содержимому работает');
    assert.deepStrictEqual(store.search('секрет'), [], 'файл из .gitignore не попал в индекс');
  });

  test('IDX-6: пачки пишут индекс на диск по ходу сборки', async function () {
    this.timeout(60000);
    for (let i = 0; i < 30; i += 1) write(`f${i}.md`, `заметка ${i} про бюджет`);
    const indexer = new SearchIndexer(store, diskAdapter(tmpRoot), { batchSize: 10 });
    await indexer.fullBuild();

    assert.ok(fs.existsSync(indexPath), 'файл индекса создан');
    assert.ok(fs.statSync(indexPath).size > 0, 'файл не пустой');

    // Перезапуск: новый экземпляр видит проиндексированное
    const reopened = new SearchIndexStore(sqlite3, { indexPath });
    await reopened.init();
    assert.ok(reopened.search('бюджет').length > 0, 'после перезапуска поиск работает');
    reopened.close();
  });

  test('IDX-5: инкремент — изменение и удаление одного файла', async function () {
    this.timeout(60000);
    write('app.ts', 'старое содержимое про лимит');
    const indexer = new SearchIndexer(store, diskAdapter(tmpRoot), {});
    await indexer.fullBuild();
    assert.strictEqual(store.search('старое').length, 1);

    // Изменили файл
    write('app.ts', 'новое содержимое про прогноз');
    const stat = fs.statSync(path.join(tmpRoot, 'app.ts'));
    await indexer.updateFile({ relPath: 'app.ts', size: stat.size, mtime: Math.round(stat.mtimeMs) });

    assert.deepStrictEqual(store.search('старое'), [], 'старое содержимое больше не находится');
    assert.strictEqual(store.search('прогноз').length, 1, 'новое содержимое найдено');

    // Удалили файл
    fs.rmSync(path.join(tmpRoot, 'app.ts'));
    indexer.removeFile('app.ts');
    assert.deepStrictEqual(store.search('прогноз'), [], 'после удаления файла выдача пуста');
    assert.strictEqual(store.stats().files, 0);
  });

  test('IDX-13: бинарные и UTF-16 без BOM не индексируются, сборка не падает', async function () {
    this.timeout(60000);
    write('ok.ts', 'обычный текст про стоимость');
    write('binary.txt', Buffer.from([0x00, 0x01, 0x02, 0x41, 0x42]));
    write('utf16.txt', Buffer.from('\uFEFFфайл в кодировке utf16', 'utf16le'));
    write('broken.txt', Buffer.from([0xff, 0xfe, 0xfd, 0xfa, 0x00, 0x01]));

    const indexer = new SearchIndexer(store, diskAdapter(tmpRoot), {});
    const stats = await indexer.fullBuild();

    assert.ok(stats.indexed >= 2, `текст и UTF-16 с BOM проиндексированы: ${stats.indexed}`);
    assert.ok((stats.reasons['не текст'] ?? 0) >= 1, `не-текст посчитан: ${JSON.stringify(stats.reasons)}`);
    assert.strictEqual(store.search('стоимость').length, 1, 'текстовый файл на месте');
    const utf16Hits = store.search('кодировке').map((hit) => hit.path);
    assert.deepStrictEqual(utf16Hits, ['utf16.txt'], `UTF-16 с BOM индексируется как текст: ${utf16Hits}`);
    // Битый файл не должен добавлять в индекс ничего своего
    assert.deepStrictEqual(store.search('битый'), [], 'битый файл в индекс не попал');

    // Чистые функции
    assert.strictEqual(decodeIndexableText(Buffer.from([0x00, 0x41])), null, 'NUL без BOM — не текст');
    assert.strictEqual(decodeIndexableText(Buffer.from('\uFEFFпривет', 'utf16le')), 'привет', 'UTF-16LE с BOM читается');
    assert.strictEqual(skipReason({ relPath: 'a/b.min.js', size: 10, mtime: 0 }), 'lock/минифицированный');
  });

  test('IDX-14: два корня индексируются независимо (основа multi-root)', async function () {
    this.timeout(60000);
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-idx-root2-'));
    try {
      write('one.ts', 'первый корень: лимит бюджета');
      fs.writeFileSync(path.join(secondRoot, 'two.ts'), 'второй корень: лимит бюджета');

      const secondIndex = path.join(secondRoot, '.index', 'ws.sqlite');
      const store2 = new SearchIndexStore(sqlite3, { indexPath: secondIndex });
      await store2.init();

      await new SearchIndexer(store, diskAdapter(tmpRoot), {}).fullBuild();
      await new SearchIndexer(store2, diskAdapter(secondRoot), {}).fullBuild();

      const hitsA = store.search('лимит бюджета').map((hit) => hit.path);
      const hitsB = store2.search('лимит бюджета').map((hit) => hit.path);
      assert.deepStrictEqual(hitsA, ['one.ts'], `выдача первого корня: ${hitsA}`);
      assert.deepStrictEqual(hitsB, ['two.ts'], `выдача второго корня: ${hitsB}`);
      store2.close();
    } finally {
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  test('IDX-15: сверка при старте обновляет изменённое и убирает исчезнувшее', async function () {
    this.timeout(60000);
    write('a.ts', 'первая версия');
    write('b.ts', 'второй файл');
    const indexer = new SearchIndexer(store, diskAdapter(tmpRoot), {});
    await indexer.fullBuild();
    assert.strictEqual(store.stats().files, 2);

    write('a.ts', 'изменённая версия подлиннее');
    fs.rmSync(path.join(tmpRoot, 'b.ts'));

    const stats = await indexer.reconcile();
    assert.strictEqual(stats.indexed, 1, `обновлён один файл: ${stats.indexed}`);
    assert.strictEqual(stats.removed, 1, `удалён один файл: ${stats.removed}`);
    assert.strictEqual(store.stats().files, 1);
    assert.strictEqual(store.search('изменённая').length, 1, 'новая версия в индексе');
  });
});
