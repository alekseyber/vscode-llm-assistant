// SearchIndexer — наполнение индекса из рабочего пространства (P8, этап S2).
//
// Логика отделена от VS Code API через адаптер файловой системы: так её можно проверить
// тестами на настоящем диске, а не на моках, и переиспользовать для multi-root.
//
// Инварианты:
//   - сбой одного файла не прерывает сборку (считаем в skipped и идём дальше);
//   - работа идёт пачками с `await` между пачками: Extension Host однопоточный;
//   - после каждой пачки — flush, чтобы падение процесса не теряло весь индекс;
//   - потолки (файлы/байты) не урезают молча: попадают в статистику и debug.

import { isIgnored, parseGitignore } from './gitignore';
import { MAX_INDEXED_FILE_BYTES, SearchIndexStore } from './SearchIndex';

/** Потолок числа файлов в индексе. */
export const MAX_INDEX_FILES = 20_000;

/** Размер пачки: 200 файлов, между пачками отдаём управление хосту. */
export const INDEX_BATCH_SIZE = 200;

/** Как часто писать индекс на диск: каждые 5 пачек (≈1000 файлов). */
export const FLUSH_EVERY_BATCHES = 5;

/** Каталоги, которые не индексируем никогда (не зависят от .gitignore). */
export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'out', '.git', '.vscode-test', '.next', 'build', 'coverage', 'vendor',
]);

/** Текстовые расширения, которые индексируем. */
export const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt', '.yml', '.yaml',
  '.css', '.scss', '.less', '.html', '.xml', '.svg', '.sql', '.sh', '.bash', '.ps1', '.py', '.rb',
  '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.vue', '.svelte',
  '.toml', '.ini', '.cfg', '.conf', '.gradle', '.properties', '.graphql', '.proto', '.env.example',
]);

/** Файлы, которые пропускаем по имени, даже если расширение текстовое. */
const SKIP_FILE_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];

export interface IndexSourceFile {
  /** Путь относительно корня рабочего пространства */
  relPath: string;
  size: number;
  mtime: number;
}

export interface IndexFsAdapter {
  /** Все файлы под корнем (без фильтрации — фильтры применяет индексатор). */
  listFiles(): Promise<IndexSourceFile[]>;
  /** Прочитать файл как байты. */
  readFile(relPath: string): Promise<Uint8Array>;
  /** Правила .gitignore (пустой массив, если файла нет). */
  readGitignore?(): Promise<string[]>;
}

export interface IndexStats {
  indexed: number;
  skipped: number;
  removed: number;
  /** Причины пропуска: расширение, размер, бинарный, .gitignore, потолок */
  reasons: Record<string, number>;
  truncated: boolean;
}

/** Почему файл не индексируется (или `null`, если индексируется). */
/** Файлы без расширения, которые всё равно текст (иначе `Makefile` и `.env` выпадают). */
export const TEXT_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Procfile', 'Jenkinsfile', 'Rakefile', 'Gemfile', 'LICENSE', 'NOTICE',
  '.env', '.env.example', '.gitignore', '.dockerignore', '.editorconfig', '.npmrc', '.nvmrc',
]);

/** Расширение файла по имени, а не по всему пути: точка в имени каталога не должна мешать. */
export function fileExtension(relPath: string): string {
  const base = relPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  // Скрытый файл без расширения (`.env`) считаем именем, а не расширением
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function skipReason(
  file: IndexSourceFile,
  ignoreRules: readonly string[] = [],
  maxFileBytes = MAX_INDEXED_FILE_BYTES,
): string | null {
  const rel = file.relPath.replace(/\\/g, '/');
  const segments = rel.split('/');
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return 'каталог';
  if (SKIP_FILE_PATTERNS.some((rx) => rx.test(rel))) return 'lock/минифицированный';
  const base = segments[segments.length - 1];
  const ext = fileExtension(rel);
  if (!TEXT_EXTENSIONS.has(ext) && !TEXT_FILENAMES.has(base)) return 'расширение';
  if (file.size > maxFileBytes) return 'размер';
  if (isIgnored(rel, ignoreRules)) return '.gitignore';
  return null;
}

/**
 * Декодировать файл как текст. `null` — не текст (NUL-байт, битый UTF-8, UTF-16 без BOM).
 *
 * Белого списка расширений мало: UTF-16, бинарный `.txt` и минифицированный JSON проходят
 * по расширению, а в индекс попадать не должны.
 */
export function decodeIndexableText(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return '';
  // NUL в первых 4 КБ — почти всегда бинарник
  const probeLength = Math.min(bytes.length, 4096);
  for (let i = 0; i < probeLength; i += 1) {
    if (bytes[i] === 0x00) {
      // UTF-16LE/BE тоже содержит NUL-байты через один — их проверяем отдельно по BOM
      const hasBom =
        (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
        (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff);
      if (!hasBom) return null;
      break;
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // UTF-16 с BOM: пробуем LE/BE по префиксу
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    return null;
  }
}

/** Сколько байт сверяем по crc32 у свежих файлов: mtime на грубых ФС врёт. */
const CRC_PROBE_BYTES = 4096;

/** Файлы, изменённые в этот интервал, дополнительно сверяем по crc32. */
const RECENT_MS = 5_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** crc32 первых `CRC_PROBE_BYTES` байт: дешёвая сверка содержимого. */
export function crc32(bytes: Uint8Array, limit = CRC_PROBE_BYTES): number {
  const end = Math.min(bytes.length, limit);
  let crc = 0xffffffff;
  for (let i = 0; i < end; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Отдать управление хосту между пачками: Extension Host однопоточный. */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Наполняет индекс из рабочего пространства. Адаптер ФС передаётся снаружи
 * (в расширении — обёртка над `vscode.workspace.fs`, в тестах — настоящий диск).
 */
export class SearchIndexer {
  private readonly store: SearchIndexStore;
  private readonly fs: IndexFsAdapter;
  private readonly maxFiles: number;
  private readonly batchSize: number;
  private readonly onDebug?: (message: string) => void;
  private ignoreRules: string[] = [];

  constructor(
    store: SearchIndexStore,
    adapter: IndexFsAdapter,
    options: { maxFiles?: number; batchSize?: number; onDebug?: (message: string) => void } = {},
  ) {
    this.store = store;
    this.fs = adapter;
    this.maxFiles = options.maxFiles ?? MAX_INDEX_FILES;
    this.batchSize = options.batchSize ?? INDEX_BATCH_SIZE;
    this.onDebug = options.onDebug;
  }

  private debug(message: string): void {
    this.onDebug?.(`[indexer] ${message}`);
  }

  /**
   * Перечитать `.gitignore`. Ошибка чтения НЕ обнуляет правила: иначе временный сбой ФС
   * индексировал бы всё, что пользователь явно исключил.
   */
  private async readGitignoreRules(): Promise<void> {
    try {
      const rules = await this.fs.readGitignore?.();
      if (rules) this.ignoreRules = rules;
    } catch (error: any) {
      this.debug(`.gitignore не прочитан, работаем на прежних правилах: ${error?.message ?? String(error)}`);
    }
  }

  /** Полная сборка: обход, фильтры, пачки, flush после каждой пачки. */
  async fullBuild(): Promise<IndexStats> {
    const stats: IndexStats = { indexed: 0, skipped: 0, removed: 0, reasons: {}, truncated: false };
    await this.readGitignoreRules();

    let files = await this.fs.listFiles();
    const candidates: IndexSourceFile[] = [];
    for (const file of files) {
      const reason = skipReason(file, this.ignoreRules);
      if (reason) {
        stats.skipped += 1;
        stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
        continue;
      }
      candidates.push(file);
    }

    // Список «что есть на диске» запоминаем ДО потолка: иначе файлы, не влезшие в лимит,
    // удалялись бы из индекса при следующей сборке, хотя они никуда не делись
    const present = new Set(candidates.map((file) => file.relPath));
    if (candidates.length > this.maxFiles) {
      // Молча урезать нельзя: оставляем самые свежие и говорим об этом
      candidates.sort((a, b) => b.mtime - a.mtime);
      stats.truncated = true;
      stats.reasons['потолок файлов'] = candidates.length - this.maxFiles;
      this.debug(`файлов ${candidates.length} больше потолка ${this.maxFiles}: индексируем свежие`);
      candidates.length = this.maxFiles;
    }

    let batchNo = 0;
    for (let i = 0; i < candidates.length; i += this.batchSize) {
      const batch = candidates.slice(i, i + this.batchSize);
      for (const file of batch) {
        const outcome = await this.indexOne(file, stats);
        if (outcome) stats.indexed += 1;
        else stats.skipped += 1;
      }
      batchNo += 1;
      await yieldToHost();
      // Писать весь файл индекса после каждой пачки дорого (100 записей на 20 000 файлов):
      // фиксируем каждые 5 пачек, а последнюю — сразу после цикла
      if (batchNo % FLUSH_EVERY_BATCHES === 0) await this.store.flush();
    }

    // Пустой обход при непустом индексе — почти наверняка сбой ФС (сетевой диск, права),
    // а не «все файлы удалили». Молча стирать индекс в этом случае нельзя
    if (candidates.length === 0 && this.store.stats().files > 0) {
      this.debug('обход вернул 0 файлов — индекс не очищаем, работаем на старых данных');
      await this.store.flush();
      return stats;
    }

    // Удаляем из индекса то, чего больше нет на диске
    for (const entry of this.store.listIndexed()) {
      if (!present.has(entry.path)) {
        this.store.removeFile(entry.path);
        stats.removed += 1;
      }
    }
    await this.store.flush();
    return stats;
  }

  private async indexOne(file: IndexSourceFile, stats: IndexStats): Promise<boolean> {
    try {
      const bytes = await this.fs.readFile(file.relPath);
      const text = decodeIndexableText(bytes);
      if (text === null) {
        stats.reasons['не текст'] = (stats.reasons['не текст'] ?? 0) + 1;
        this.debug(`пропущен не-текст: ${file.relPath}`);
        return false;
      }
      return this.store.upsertFile({
        path: file.relPath,
        body: text,
        size: file.size,
        mtime: file.mtime,
        crc: crc32(bytes),
      });
    } catch (error: any) {
      this.debug(`не прочитан ${file.relPath}: ${error?.message ?? String(error)}`);
      stats.reasons['ошибка чтения'] = (stats.reasons['ошибка чтения'] ?? 0) + 1;
      return false;
    }
  }

  /** Инкремент: один файл изменился или появился. */
  async updateFile(file: IndexSourceFile): Promise<boolean> {
    const reason = skipReason(file, this.ignoreRules);
    if (reason) {
      // «Размер» — состояние, которое может быть временным (недописанный файл, распаковка):
      // такой файл не удаляем из индекса сразу, иначе он исчезнет из выдачи навсегда
      const persistent = reason !== 'размер';
      if (persistent) {
        this.store.removeFile(file.relPath);
        this.debug(`файл больше не индексируется (${reason}): ${file.relPath}`);
      } else {
        this.debug(`файл пропущен (${reason}), из индекса не удаляем: ${file.relPath}`);
      }
      return false;
    }
    const stats: IndexStats = { indexed: 0, skipped: 0, removed: 0, reasons: {}, truncated: false };
    return this.indexOne(file, stats);
  }

  /** Инкремент: файл удалён (или переименован — тогда пара delete+insert). */
  removeFile(relPath: string): void {
    this.store.removeFile(relPath);
  }

  /**
   * Сверка при старте: индексируем новое и изменившееся (размер/mtime),
   * удаляем исчезнувшее. Полная перестройка не нужна, если изменилось немного.
   */
  async reconcile(): Promise<IndexStats> {
    const stats: IndexStats = { indexed: 0, skipped: 0, removed: 0, reasons: {}, truncated: false };
    await this.readGitignoreRules();
    const indexed = new Map(this.store.listIndexed().map((entry) => [entry.path, entry]));
    const files = await this.fs.listFiles();
    const present = new Set<string>();

    for (const file of files) {
      const reason = skipReason(file, this.ignoreRules);
      if (reason) {
        if (indexed.has(file.relPath)) {
          this.store.removeFile(file.relPath);
          stats.removed += 1;
        }
        continue;
      }
      present.add(file.relPath);
      const known = indexed.get(file.relPath);
      let changed = !known || known.size !== file.size || known.mtime !== file.mtime;
      // mtime на грубых ФС (и после git checkout) врёт: свежие файлы сверяем по содержимому
      if (!changed && known && Date.now() - file.mtime <= RECENT_MS) {
        try {
          const probe = await this.fs.readFile(file.relPath);
          changed = crc32(probe) !== (known.crc ?? -1);
        } catch {
          // Не читается — считаем, что не изменился: удалять запись из-за сбоя чтения нельзя
          changed = false;
        }
      }
      if (changed) {
        const ok = await this.indexOne(file, stats);
        if (ok) stats.indexed += 1;
      }
    }

    for (const path of indexed.keys()) {
      if (!present.has(path)) {
        this.store.removeFile(path);
        stats.removed += 1;
      }
    }

    if (stats.indexed > 0 || stats.removed > 0) await this.store.flush();
    this.debug(`сверка: обновлено ${stats.indexed}, удалено ${stats.removed}`);
    return stats;
  }
}

/** Разобрать .gitignore в правила — реэкспорт, чтобы адаптерам не тянуть ToolDefinitions. */
export { parseGitignore };
