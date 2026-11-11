// SearchIndex — локальный лексический индекс кодовой базы (SQLite FTS5, ранжирование BM25).
//
// Контракт инструмента `search_files` НЕ меняется: индекс — внутренняя деталь, которая
// улучшает выдачу. Отсутствие индекса, порча файла или недоступность WASM не ломают поиск,
// а откатывают его к прежнему ripgrep-поведению (см. specs/SearchIndex.md).
//
// Модуль `@sqlite.org/sqlite-wasm` в ESM-формате, поэтому сюда он передаётся снаружи
// (инъекция): код остаётся тестируемым в CJS-сборке, а загрузка модуля — забота activate().

import * as fs from 'fs';
import * as path from 'path';

/** Версия схемы индекса. Расхождение → индекс пересобирается целиком. */
export const INDEX_SCHEMA_VERSION = 1;

/** Потолок размера файла для индексации (байты). */
export const MAX_INDEXED_FILE_BYTES = 512 * 1024;

/** Веса BM25: путь важнее тела — файл `costCalc.ts` релевантнее упоминания в тексте. */
const PATH_WEIGHT = 4.0;
const BODY_WEIGHT = 1.0;

/** Потолок токенов в FTS-запросе: длинный запрос размывает ранжирование. */
const MAX_QUERY_TOKENS = 12;

/**
 * Слова, которые не несут смысла для лексического поиска и ломают AND:
 * «где считается стоимость» без этого не находил файл, потому что «где» нет в коде.
 */
const STOP_WORDS = new Set([
  'где', 'что', 'как', 'для', 'это', 'или', 'при', 'над', 'под', 'без', 'все', 'его', 'она', 'они',
  'есть', 'был', 'была', 'были', 'надо', 'нужно', 'можно', 'пожалуйста', 'найди', 'покажи', 'поиск',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'you', 'find', 'search',
  // Операторы FTS5 и английские служебные слова: в MATCH они либо меняют логику, либо шумят
  'or', 'not', 'near', 'in', 'of', 'to', 'is', 'it', 'on', 'by',
]);

/** Частые русские окончания: цель — свести словоформы, а не лингвистическая точность. */
const RU_SUFFIXES = [
  'ами', 'ями', 'ов', 'ев', 'ий', 'ый', 'ая', 'ое', 'ые', 'ие', 'ой', 'ей',
  'ам', 'ям', 'ом', 'ем', 'ах', 'ях', 'ую', 'юю', 'ть', 'ся', 'ии', 'ия',
  // односимвольные окончания — самые частые: «стоимость/стоимости», «файл/файлы»
  'и', 'ы', 'а', 'о', 'е', 'у', 'ю', 'ь',
];

/**
 * Нормализовать текст для FTS5.
 *
 * - нижний регистр, `ё`→`е`, пунктуация → пробел;
 * - идентификаторы разбиваются на части: `calculateCost` → `calculate cost calculatecost`;
 * - русские окончания отсекаются простым списком; английские формы не трогаем
 *   (агенту чаще нужны точные идентификаторы).
 */
/** Разбить текст на слова: нижний регистр, `ё`→`е`, camelCase/snake_case → части. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  // Регистр важен: границу camelCase видно только ДО приведения к нижнему регистру
  const withParts = text
    .replace(/([a-zа-я0-9])([A-ZА-Я])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  return withParts.split(/\s+/).filter(Boolean);
}

/**
 * Нормализовать текст для индексируемой колонки: исходные слова **и** их основы.
 * Индекс — надмножество: запрос идёт по основам, иначе «считается» в запросе
 * не найдёт «считает» в файле.
 */
export function normalizeText(text: string): string {
  const out: string[] = [];
  for (const word of tokenize(text)) {
    if (!out.includes(word)) out.push(word);
    const stemmed = stemRussian(word);
    if (stemmed !== word && !out.includes(stemmed)) out.push(stemmed);
  }
  return out.join(' ');
}

/** Отсечь частое русское окончание. Английские слова и короткие основы не трогаем. */
export function stemRussian(word: string): string {
  if (!/[а-я]/.test(word) || word.length < 5) return word;
  for (const suffix of RU_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/**
 * Собрать безопасный запрос FTS5 из текста пользователя.
 *
 * Сырой текст в MATCH отправлять нельзя: `(`, `-`, `"`, `OR`, `NOT` — операторы FTS5,
 * и «где считается стоимость (run)» даёт либо синтаксическую ошибку, либо другую логику.
 */
export function buildFtsQuery(text: string, maxTokens = MAX_QUERY_TOKENS): string {
  // В запрос идут только основы: индекс содержит и словоформы, и основы,
  // а AND по словоформам («считается») не находил «считает» в файле
  const tokens: string[] = [];
  for (const word of tokenize(text)) {
    if (STOP_WORDS.has(word) || word.length < 2) continue;
    const canonical = stemRussian(word);
    if (canonical.length < 2) continue;
    if (!STOP_WORDS.has(canonical) && !tokens.includes(canonical)) tokens.push(canonical);
  }
  const limited = tokens.slice(0, maxTokens);
  if (limited.length === 0) return '';
  const tokensOut = limited;
  if (tokensOut.length === 1) return `"${tokensOut[0]}"`;
  return tokensOut.map((token) => `"${token}"`).join(' ');
}

export interface IndexEntry {
  /** Путь относительно корня рабочего пространства */
  path: string;
  /** Исходный текст файла (нужен для сниппетов) */
  body: string;
  size: number;
  mtime: number;
}

export interface SearchHit {
  path: string;
  /** BM25: меньше — лучше */
  rank: number;
  snippet: string;
}

export interface SearchIndexOptions {
  /** Абсолютный путь к файлу индекса в globalStorage */
  indexPath: string;
  /** Канал «LLM Assistant» */
  onDebug?: (message: string) => void;
}

/**
 * Обёртка над SQLite FTS5. Экземпляр живёт в памяти, на диск пишется через `flush()`
 * (sqlite-wasm не открывает файлы хоста напрямую).
 */
export class SearchIndexStore {
  private readonly sqlite3: any;
  private readonly indexPath: string;
  private readonly onDebug?: (message: string) => void;
  private db: any;
  private ready = false;

  constructor(sqlite3: any, options: SearchIndexOptions) {
    this.sqlite3 = sqlite3;
    this.indexPath = options.indexPath;
    this.onDebug = options.onDebug;
  }

  private debug(message: string): void {
    this.onDebug?.(`[index] ${message}`);
  }

  /**
   * Открыть индекс. `false` — индекс недоступен, вызывающий код работает как раньше.
   *
   * Файл со старой схемой удаляется: частичных миграций нет, пересборка дешевле ошибок
   * совместимости (см. контракт в спеке).
   */
  async init(): Promise<boolean> {
    // Повторный init на том же инстансе: сначала закрываем прежнюю БД,
    // иначе буфер, освобождаемый FREEONCLOSE, может быть освобождён дважды
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* уже закрыта */
      }
      this.db = undefined;
    }
    try {
      this.db = new this.sqlite3.oo1.DB(':memory:', 'c');
    } catch (error: any) {
      this.debug(`SQLite недоступен: ${error?.message ?? String(error)}`);
      return false;
    }

    try {
      const existing = await this.readIndexFile();
      if (existing) {
        // sqlite3_deserialize принимает мусор «успешно»: ошибка вылезает на первом запросе,
        // поэтому проверяем файл реальным чтением, а не только кодом возврата
        let usable = this.deserialize(existing);
        if (usable) {
          try {
            const version = this.userVersion();
            usable = version === INDEX_SCHEMA_VERSION;
            if (!usable) {
              this.debug(`схема индекса ${version} вместо ${INDEX_SCHEMA_VERSION} — пересобираем`);
            }
          } catch (error: any) {
            this.debug(`файл индекса не читается: ${error?.message ?? String(error)} — пересобираем`);
            usable = false;
          }
        } else {
          this.debug('файл индекса не открылся — пересобираем');
        }
        if (!usable) {
          this.resetDatabase();
          await this.deleteIndexFile();
        }
      }
      this.ensureSchema();
      this.ready = true;
      return true;
    } catch (error: any) {
      this.debug(`инициализация индекса провалилась: ${error?.message ?? String(error)}`);
      this.ready = false;
      return false;
    }
  }

  private resetDatabase(): void {
    try {
      this.db.close();
    } catch {
      /* закрывать нечего */
    }
    this.db = new this.sqlite3.oo1.DB(':memory:', 'c');
  }

  private async readIndexFile(): Promise<Uint8Array | null> {
    try {
      const data = await fs.promises.readFile(this.indexPath);
      return new Uint8Array(data);
    } catch {
      return null;
    }
  }

  private deserialize(bytes: Uint8Array): boolean {
    try {
      const pointer = this.sqlite3.wasm.allocFromTypedArray(bytes);
      const flags =
        this.sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        this.sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      const rc = this.sqlite3.capi.sqlite3_deserialize(
        this.db.pointer,
        'main',
        pointer,
        bytes.length,
        bytes.length,
        flags,
      );
      return rc === 0;
    } catch {
      return false;
    }
  }

  private userVersion(): number {
    const rows = this.db.exec({
      sql: 'PRAGMA user_version',
      rowMode: 'array',
      returnValue: 'resultRows',
    });
    return Number(rows?.[0]?.[0] ?? 0);
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files(
        path TEXT PRIMARY KEY, ext TEXT, size INTEGER, mtime INTEGER, crc INTEGER
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
        path UNINDEXED, path_tokens, body_norm
      );
    `);
    if (this.userVersion() !== INDEX_SCHEMA_VERSION) {
      this.db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
    }
  }

  /** Перезаписать файл в индексе (delete + insert: так проще, чем upsert по двум таблицам). */
  upsertFile(entry: IndexEntry): boolean {
    if (!this.ready) return false;
    const ext = path.extname(entry.path).toLowerCase();
    const body = entry.body.slice(0, MAX_INDEXED_FILE_BYTES);
    const bodyNorm = normalizeText(body);
    const pathNorm = normalizeText(entry.path);
    try {
      // Транзакция: иначе ошибка на второй вставке оставляет файл в `files` без строки в `fts`
      this.db.exec('BEGIN');
      this.db.exec({ sql: 'DELETE FROM files WHERE path = ?', bind: [entry.path] });
      this.db.exec({ sql: 'DELETE FROM fts WHERE path = ?', bind: [entry.path] });
      this.db.exec({
        sql: 'INSERT INTO files(path, ext, size, mtime, crc) VALUES(?,?,?,?,?)',
        bind: [entry.path, ext, entry.size, entry.mtime, null],
      });
      this.db.exec({
        sql: 'INSERT INTO fts(path, path_tokens, body_norm) VALUES(?,?,?)',
        bind: [entry.path, pathNorm, bodyNorm],
      });
      this.db.exec('COMMIT');
      return true;
    } catch (error: any) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* транзакция могла не начаться */
      }
      this.debug(`не удалось проиндексировать ${entry.path}: ${error?.message ?? String(error)}`);
      return false;
    }
  }

  removeFile(filePath: string): void {
    if (!this.ready) return;
    this.db.exec({ sql: 'DELETE FROM files WHERE path = ?', bind: [filePath] });
    this.db.exec({ sql: 'DELETE FROM fts WHERE path = ?', bind: [filePath] });
  }

  /** Поиск по естественному языку. Пустая выдача или пустой запрос — сигнал вызывающему коду. */
  search(query: string, limit = 5): SearchHit[] {
    if (!this.ready) return [];
    const match = buildFtsQuery(query);
    if (!match) return [];
    try {
      const rows = this.db.exec({
        // bm25() принимает только литералы: параметры (? ) в весах дают ошибку SQLite
        sql:
          `SELECT path, bm25(fts, ${PATH_WEIGHT}, ${BODY_WEIGHT}) AS rank, ` +
          "snippet(fts, 2, '', '', '…', 20) " +
          'FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?',
        bind: [match, Math.max(1, limit)],
        rowMode: 'array',
        returnValue: 'resultRows',
      });
      return (rows ?? []).map((row: any[]) => ({
        path: String(row[0]),
        rank: Number(row[1]),
        snippet: String(row[2] ?? '').slice(0, 200),
      }));
    } catch (error: any) {
      this.debug(`запрос не выполнен: ${error?.message ?? String(error)}`);
      return [];
    }
  }

  /** Выгрузить БД в байты (для тестов и атомарной записи). */
  export(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db);
  }

  /** Записать индекс на диск атомарно: temp + rename, чтобы не оставить половину файла. */
  async flush(): Promise<void> {
    if (!this.ready) return;
    const dir = path.dirname(this.indexPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${this.indexPath}.tmp`;
    const bytes = this.export();
    if (!bytes || bytes.length === 0) {
      this.debug('экспорт индекса вернул пустые данные — файл не перезаписываем');
      return;
    }
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, this.indexPath);
  }

  private async deleteIndexFile(): Promise<void> {
    try {
      await fs.promises.rm(this.indexPath, { force: true });
    } catch {
      /* файла нет — и не надо */
    }
  }

  stats(): { files: number; ready: boolean } {
    if (!this.ready) return { files: 0, ready: false };
    const rows = this.db.exec({
      sql: 'SELECT count(*) FROM files',
      rowMode: 'array',
      returnValue: 'resultRows',
    });
    return { files: Number(rows?.[0]?.[0] ?? 0), ready: true };
  }

  close(): void {
    this.ready = false;
    try {
      this.db?.close();
    } catch {
      /* уже закрыта */
    }
  }
}
