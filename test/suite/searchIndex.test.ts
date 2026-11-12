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
  pathPenalty,
  applyPathPenalty,
  firstMeaningfulLine,
  countMatchedTokens,
} from '../../src/shared/SearchIndex';

/** Минимум sqlite-API, который нужен тесту: exec строкой и чтение результата массивом. */
interface RawSqliteDb {
  exec(sql: string): unknown;
  exec(options: { sql: string; rowMode: 'array'; returnValue: 'resultRows' }): number[][];
}

/**
 * Хэндл sqlite, которым пользуется хранилище. Поле `db` приватное и в src типизировано
 * как `any` (WASM-модуль без типов) — снаружи достаём его структурным типом, чтобы
 * сломать версию схемы мимо публичного API.
 */
function rawDb(store: SearchIndexStore): RawSqliteDb {
  return (store as unknown as { db: RawSqliteDb }).db;
}

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
    rawDb(seed).exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION + 5}`);
    await seed.flush();
    seed.close();

    const reopened = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await reopened.init(), true, 'индекс открылся');
    assert.strictEqual(reopened.stats().files, 0, 'старые данные не перенесены — индекс пуст');
    const version = rawDb(reopened).exec({ sql: 'PRAGMA user_version', rowMode: 'array', returnValue: 'resultRows' });
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

  test('IDX-28: перевес путей — исходники важнее тестов, спек и документации', () => {
    assert.ok(pathPenalty('src/modes/chat/ModelRouter.ts') < 1, 'src получает перевес');
    assert.ok(pathPenalty('test/suite/modelRouter.test.ts') > 2, 'тесты отодвигаются');
    assert.ok(pathPenalty('specs/ModelRouter.md') > 2, 'спеки отодвигаются');
    assert.ok(pathPenalty('docs/readme.md') > 1, 'документация отодвигается слабее тестов');
    assert.strictEqual(pathPenalty('package.json'), 1, 'корневые файлы — без перевеса');
  });

  test('IDX-31: перевес учитывает знак bm25 и не разрезает суррогатные пары', () => {
    // FTS5 отдаёт bm25 отрицательным: у теста ранг должен приблизиться к нулю (хуже),
    // у src — отдалиться (лучше). Положительный ранг (нестандартный случай) — наоборот.
    assert.ok(applyPathPenalty(-10, 'test/suite/x.test.ts') > -10, 'тест отодвигается');
    assert.ok(applyPathPenalty(-10, 'src/x.ts') < -10, 'исходник поднимается');
    assert.strictEqual(applyPathPenalty(10, 'test/suite/x.test.ts'), 22, 'положительный ранг умножается');
    assert.ok(applyPathPenalty(10, 'src/x.ts') < 10, 'положительный ранг для src уменьшается');

    const long = '🙂'.repeat(200);
    const snippet = firstMeaningfulLine(long, 20);
    assert.ok(!snippet.includes('\uFFFD'), `фрагмент не содержит битых символов: ${snippet}`);
    assert.strictEqual(Array.from(snippet).length, 20, 'длина по кодовым точкам');
  });

  test('IDX-33: число совпавших слов запроса считается по основам, без повторов', () => {
    const body = 'Лимит бюджета сессии и дневной лимит бюджета: лимит проверяется до отправки';
    // «лимит», «бюджет», «сессии» — три основы; повтор «лимит» не увеличивает счёт
    assert.strictEqual(countMatchedTokens('где лимит бюджета сессии', body), 3);
    // Слово, которого нет в тексте, не считается
    assert.strictEqual(countMatchedTokens('где лимит бюджета телеграм', body), 2);
    // Пустой запрос и пустой текст — ноль, не падение
    assert.strictEqual(countMatchedTokens('где', body), 0);
    assert.strictEqual(countMatchedTokens('где лимит', ''), 0);
  });

  test('IDX-29: фрагмент — первая содержательная строка файла, а не склейка основ', async () => {
    const store = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await store.init(), true);

    const body = [
      '// Модуль расчёта стоимости прогона',
      '',
      'export function calculateCost(model: string, tokensIn: number): number {',
      '  return tokensIn * 0.001;',
      '}',
    ].join('\n');
    store.upsertFile({ path: 'src/pricing.ts', body, size: body.length, mtime: Date.now() });

    const hits = store.search('расчёт стоимости прогона');
    assert.strictEqual(hits.length, 1, `файл найден: ${JSON.stringify(hits)}`);
    assert.ok(
      hits[0].snippet.startsWith('Модуль расчёта стоимости прогона'),
      `фрагмент должен быть читаемой строкой файла: ${hits[0].snippet}`,
    );
    assert.ok(!/\bрасч[а-я]*\b\s+стоимост[а-я]*\s+прогон[а-я]*\s+модул/i.test(hits[0].snippet) ||
      hits[0].snippet === 'Модуль расчёта стоимости прогона',
      `фрагмент не должен быть нормализованной склейкой: ${hits[0].snippet}`);
    store.close();
  });

  test('IDX-30: при одинаковом содержимом исходник идёт выше теста', async () => {
    const store = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await store.init(), true);

    const body = 'export function calculateCost(tokens: number) { return tokens * 0.001; }';
    // Тест записан первым: без перевеса он и остался бы первым в выдаче
    store.upsertFile({ path: 'test/suite/pricing.test.ts', body, size: body.length, mtime: Date.now() });
    store.upsertFile({ path: 'src/shared/pricing.ts', body, size: body.length, mtime: Date.now() });

    const hits = store.search('calculateCost');
    assert.strictEqual(hits[0].path, 'src/shared/pricing.ts', `порядок выдачи: ${JSON.stringify(hits.map((h) => h.path))}`);
    store.close();
  });

  // IDX-35: путь весит больше тела. Схема `fts5(path UNINDEXED, path_tokens, body_norm)`,
  // веса идут по колонкам. Документы одинаковой длины, различие только в колонке совпадения:
  // при равных весах (мутация 4.0 → 1.0) ранги совпадают и порядок теряется.
  test('IDX-35: при равной частоте совпадение в пути сильнее совпадения в теле', async () => {
    const store = new SearchIndexStore(sqlite3, { indexPath });
    assert.strictEqual(await store.init(), true);

    const upsert = (filePath: string, body: string) =>
      store.upsertFile({ path: filePath, body, size: body.length, mtime: Date.now() });

    // Фон без термина: иначе idf вырождается (термин в обоих документах → bm25 ≈ 0)
    for (let i = 0; i < 8; i++) upsert(`notes/filler-${i}.md`, `filler${i} alpha beta`);
    upsert('notes/pricing.md', 'alpha beta gamma'); // термин в пути
    upsert('notes/plain.md', 'pricing alpha beta'); // термин в теле

    const hits = store.search('pricing', 5);
    const inPath = hits.find((h) => h.path === 'notes/pricing.md');
    const inBody = hits.find((h) => h.path === 'notes/plain.md');
    assert.ok(inPath && inBody, `оба файла должны быть в выдаче: ${JSON.stringify(hits.map((h) => h.path))}`);

    // Страховка от вырождения idf: если ранги нулевые, сравнение ничего не доказывает.
    // Корпус этого теста создаётся внутри него (свой индекс, свои файлы), поэтому
    // приёмочный корпус на него не влияет.
    assert.notStrictEqual(inPath!.rank, 0, 'ранг пути выродился в 0 — проверка бессмысленна');
    assert.notStrictEqual(inBody!.rank, 0, 'ранг тела выродился в 0 — проверка бессмысленна');

    // bm25 отрицателен: чем сильнее совпадение, тем больше модуль ранга
    assert.ok(
      Math.abs(inPath!.rank) > Math.abs(inBody!.rank),
      `путь должен весить больше тела: путь ${inPath!.rank.toFixed(4)}, тело ${inBody!.rank.toFixed(4)}`,
    );
    store.close();
  });

});
