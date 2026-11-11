// Тесты SearchIndex (S1): нормализация, схема, безопасный FTS5-запрос, персистентность, деградация.
// SQLite — настоящий (WASM), файл индекса — во временном каталоге.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildFtsQuery,
  normalizeText,
  stemRussian,
  tokenize,
  SearchIndexStore,
  INDEX_SCHEMA_VERSION,
} from '../../src/shared/SearchIndex';

/**
 * Пакет `@sqlite.org/sqlite-wasm` — ESM-only, а тесты собираются в CJS.
 * `new Function('return import(...)')` сохраняет настоящий динамический import.
 */
async function loadSqlite(): Promise<any> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<any>;
  const mod = await dynamicImport('@sqlite.org/sqlite-wasm');
  return typeof mod.default === 'function' ? await mod.default() : mod;
}

suite('SearchIndex / S1', () => {
  let sqlite3: any;
  let tmpDir: string;
  let indexPath: string;

  suiteSetup(async function () {
    this.timeout(120000);
    sqlite3 = await loadSqlite();
  });

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-index-'));
    indexPath = path.join(tmpDir, 'index', 'ws.sqlite');
  });

  teardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* мимо */
    }
  });

  test('IDX-1: нормализация — регистр, ё, camelCase/snake_case, русские окончания', () => {
    const normalized = normalizeText('Ёлка calculateCost PROMPT_EVAL_COUNT стоимости файла');
    // Точное значение: слабые проверки на includes проходили и при сломанном разборе camelCase
    assert.deepStrictEqual(
      tokenize('calculateCost'),
      ['calculate', 'cost'],
      'camelCase разбит на части (границу видно только до нижнего регистра)',
    );
    assert.deepStrictEqual(
      tokenize('PROMPT_EVAL_COUNT'),
      ['prompt', 'eval', 'count'],
      'snake_case разобран',
    );
    assert.strictEqual(
      normalizeText('Ёлка файла'),
      'елка файла файл',
      'ё заменена, словоформа и основа — обе в индексе',
    );

    assert.strictEqual(stemRussian('файл'), 'файл', 'короткую основу не трогаем');
    assert.strictEqual(stemRussian('code'), 'code', 'английские слова не стеммим');
    assert.ok(normalized.indexOf('елка') !== -1, 'ё→е не мешает слову');
  });

  test('IDX-10: спецсимволы FTS5 не ломают запрос', () => {
    const query = buildFtsQuery('где считается стоимость (run) - OR "x"');
    assert.strictEqual(
      query,
      '"считает" OR "стоимос" OR "run"',
      `запрос собран по основам, OR и без стоп-слов: ${query}`,
    );
    assert.strictEqual(buildFtsQuery('   ((('), '', 'из одних спецсимволов — пустой запрос');
    assert.strictEqual(buildFtsQuery(''), '');
  });

  test('IDX-2: схема создаётся, файл индексируется и находится', async () => {
    const store = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await store.init(), true, 'индекс инициализирован');
    assert.strictEqual(store.stats().files, 0, 'новый индекс пуст');

    assert.strictEqual(
      store.upsertFile({ path: 'src/shared/costCalc.ts', body: 'функция считает стоимость прогона', size: 40, mtime: Date.now() }),
      true,
      'файл записан',
    );
    assert.strictEqual(store.stats().files, 1);

    const hits = store.search('где считается стоимость');
    assert.strictEqual(hits.length, 1, `нашёлся один файл: ${JSON.stringify(hits)}`);
    assert.strictEqual(hits[0].path, 'src/shared/costCalc.ts');
    assert.ok(hits[0].snippet.length > 0, 'сниппет не пустой');
    assert.ok(hits[0].snippet.includes('стоимост'), `сниппет из body_norm: ${hits[0].snippet}`);

    // Повторная запись того же пути не плодит дубли
    store.upsertFile({ path: 'src/shared/costCalc.ts', body: 'function calculateCost() { return 0; }', size: 36, mtime: Date.now() });
    assert.strictEqual(store.stats().files, 1, 'перезапись не создаёт вторую строку');
    store.close();
  });

  test('IDX-11: индекс переживает перезапуск (flush → новый экземпляр → те же результаты)', async () => {
    const first = new SearchIndexStore(sqlite3, { indexPath });
    await first.init();
    first.upsertFile({ path: 'src/modes/chat/ModelRouter.ts', body: 'лимит бюджета сессии и прогноз стоимости', size: 40, mtime: 1 });
    await first.flush();
    first.close();
    assert.ok(fs.existsSync(indexPath), 'файл индекса записан на диск');

    const second = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await second.init(), true, 'индекс загружен из файла');
    const hits = second.search('прогноз стоимости бюджета');
    assert.strictEqual(hits.length, 1, `после перезапуска файл находится: ${JSON.stringify(hits)}`);
    assert.strictEqual(hits[0].path, 'src/modes/chat/ModelRouter.ts');
    second.close();
  });

  test('IDX-3: схема другой версии пересобирается, а не читается частично', async () => {
    const seed = new SearchIndexStore(sqlite3, { indexPath });
    await seed.init();
    seed.upsertFile({ path: 'old.ts', body: 'старый индекс', size: 10, mtime: 1 });
    (seed as any).db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION + 5}`);
    await seed.flush();
    seed.close();

    const reopened = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await reopened.init(), true, 'индекс открылся');
    assert.strictEqual(reopened.stats().files, 0, 'старые данные не перенесены — индекс пуст');
    const version = (reopened as any).db.exec({ sql: 'PRAGMA user_version', rowMode: 'array', returnValue: 'resultRows' });
    assert.strictEqual(Number(version[0][0]), INDEX_SCHEMA_VERSION, 'версия схемы обновлена');
    reopened.close();
  });

  test('IDX-12: битый файл и отсутствие SQLite не ломают поиск', async () => {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, Buffer.from('это не sqlite, а мусор'));

    const store = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await store.init(), true, 'на мусоре индекс пересобирается');
    assert.strictEqual(store.stats().files, 0);
    assert.deepStrictEqual(store.search('что угодно'), [], 'поиск по пустому индексу — пустая выдача, без исключения');
    store.close();

    // SQLite недоступен вовсе: деградация к ripgrep, без падения
    const broken = new SearchIndexStore(undefined, { indexPath });
    assert.strictEqual(await broken.init(), false, 'без SQLite индекс не поднимается');
    assert.deepStrictEqual(broken.search('x'), [], 'поиск не бросает');
    assert.strictEqual(broken.upsertFile({ path: 'a.ts', body: 'x', size: 1, mtime: 1 }), false);
  });
});
