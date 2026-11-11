// IndexService — подключение локального индекса к расширению (P8, этап S3).
//
// Задачи сервиса:
//   - поднять хранилище (sqlite-wasm) и наполнить индекс в фоне, не блокируя активацию;
//   - отдавать выдачу инструменту `search_files` через провайдер (контракт не меняется);
//   - держать индекс в актуальном состоянии через watcher;
//   - корректно деградировать: любая проблема → инструмент работает как раньше (ripgrep).

import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { SearchIndexStore } from './SearchIndex';
import { SearchIndexer, IndexSourceFile } from './SearchIndexer';
import { setIndexSearchProvider } from '../modes/apply/ToolDefinitions';

/** Исключения обхода: те же каталоги, что и в инструменте поиска. */
const SCAN_EXCLUDE = '**/{node_modules,.git,dist,out,build,coverage,.next,vendor,.vscode-test}/**';

/** Задержка склейки событий watcher: одна правка часто даёт 3–5 событий подряд. */
const WATCHER_DEBOUNCE_MS = 500;

/**
 * Загрузить sqlite-wasm. Пакет ESM-only, поэтому import настоящий динамический:
 * `new Function` не даёт TypeScript превратить его в `require`, который на ESM падает.
 */
async function loadSqlite(): Promise<any> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<any>;
  const mod = await dynamicImport('@sqlite.org/sqlite-wasm');
  return typeof mod.default === 'function' ? await mod.default() : mod;
}

/** Адаптер ФС поверх VS Code: обход уже исключает тяжёлые каталоги на уровне findFiles. */
function vscodeAdapter(root: string): {
  listFiles(): Promise<IndexSourceFile[]>;
  readFile(relPath: string): Promise<Uint8Array>;
  readGitignore(): Promise<string[]>;
} {
  return {
    async listFiles(): Promise<IndexSourceFile[]> {
      const uris = await vscode.workspace.findFiles('**/*', SCAN_EXCLUDE);
      const files: IndexSourceFile[] = [];
      for (const uri of uris) {
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          files.push({
            relPath: path.relative(root, uri.fsPath).replace(/\\/g, '/'),
            size: stat.size,
            mtime: stat.mtime,
          });
        } catch {
          // Файл исчез между обходом и stat — пропускаем
        }
      }
      return files;
    },
    async readFile(relPath: string): Promise<Uint8Array> {
      return vscode.workspace.fs.readFile(vscode.Uri.file(path.join(root, relPath)));
    },
    async readGitignore(): Promise<string[]> {
      const { parseGitignore } = await import('../modes/apply/ToolDefinitions');
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(root, '.gitignore')));
        return parseGitignore(new TextDecoder().decode(raw));
      } catch {
        return [];
      }
    },
  };
}

export class IndexService {
  private readonly disposables: vscode.Disposable[] = [];
  private watcher?: vscode.FileSystemWatcher;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private rebuildTimer?: NodeJS.Timeout;

  private constructor(
    private readonly root: string,
    private readonly store: SearchIndexStore,
    private readonly indexer: SearchIndexer,
    private readonly onDebug: (message: string) => void,
  ) {}

  /**
   * Поднять сервис. `undefined` — индекс недоступен, работаем как раньше.
   * Активация не ждёт полной сборки: она идёт в фоне.
   */
  static async start(
    context: vscode.ExtensionContext,
    onDebug: (message: string) => void,
  ): Promise<IndexService | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return undefined;

    try {
      const sqlite3 = await loadSqlite();
      const hash = crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
      const indexPath = path.join(context.globalStorageUri.fsPath, 'index', `${hash}.sqlite`);
      const store = new SearchIndexStore(sqlite3, { indexPath, onDebug });

      if (!(await store.init())) {
        onDebug('[index] хранилище недоступно — поиск работает прежним путём');
        return undefined;
      }

      const indexer = new SearchIndexer(store, vscodeAdapter(root), { onDebug });
      const service = new IndexService(root, store, indexer, onDebug);

      setIndexSearchProvider({
        search: (query: string, limit = 5) => store.search(query, limit),
      });
      service.startWatcher();

      // Фоновая сборка: не блокируем активацию и не мешаем первому запросу пользователя
      void service.warmUp();
      return service;
    } catch (error: any) {
      onDebug(`[index] не запустился: ${error?.message ?? String(error)}`);
      return undefined;
    }
  }

  /** Полная сборка при первом запуске, сверка — при последующих. */
  private async warmUp(): Promise<void> {
    try {
      const isEmpty = this.store.stats().files === 0;
      const stats = isEmpty ? await this.indexer.fullBuild() : await this.indexer.reconcile();
      this.onDebug(
        `[index] ${isEmpty ? 'сборка' : 'сверка'}: проиндексировано ${stats.indexed}, ` +
          `пропущено ${stats.skipped}, удалено ${stats.removed}`,
      );
    } catch (error: any) {
      this.onDebug(`[index] фоновая сборка не удалась: ${error?.message ?? String(error)}`);
    }
  }

  /** Watcher: изменения обновляют один файл, серия быстрых изменений — одну сверку. */
  private startWatcher(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    let changesInWindow = 0;
    let windowStartedAt = Date.now();

    const schedule = (uri: vscode.Uri, kind: 'change' | 'delete' | 'create'): void => {
      const relPath = path.relative(this.root, uri.fsPath).replace(/\\/g, '/');
      if (!relPath || relPath.startsWith('..')) return;

      // Массовая операция (git checkout большой ветки): больше 2000 изменений в минуту
      // дешевле пересобрать целиком, чем обрабатывать по одному
      if (Date.now() - windowStartedAt > 60_000) {
        changesInWindow = 0;
        windowStartedAt = Date.now();
      }
      changesInWindow += 1;
      if (changesInWindow > 2000) {
        this.scheduleFullRebuild();
        return;
      }

      const existing = this.pending.get(relPath);
      if (existing) clearTimeout(existing);
      this.pending.set(
        relPath,
        setTimeout(() => {
          this.pending.delete(relPath);
          void this.applyChange(relPath, kind);
        }, WATCHER_DEBOUNCE_MS),
      );
    };

    this.disposables.push(this.watcher.onDidChange((uri) => schedule(uri, 'change')));
    this.disposables.push(this.watcher.onDidCreate((uri) => schedule(uri, 'create')));
    this.disposables.push(this.watcher.onDidDelete((uri) => schedule(uri, 'delete')));
  }

  private async applyChange(relPath: string, kind: 'change' | 'delete' | 'create'): Promise<void> {
    if (kind === 'delete') {
      this.indexer.removeFile(relPath);
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(path.join(this.root, relPath)));
      await this.indexer.updateFile({ relPath, size: stat.size, mtime: stat.mtime });
    } catch (error: any) {
      this.onDebug(`[index] ${relPath}: ${error?.message ?? String(error)}`);
    }
  }

  private scheduleFullRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = undefined;
      void this.rebuild();
    }, 5_000);
  }

  /** Пересобрать индекс целиком (команда «Пересобрать индекс» и массовые изменения). */
  async rebuild(): Promise<void> {
    this.onDebug('[index] полная пересборка по запросу');
    await this.indexer.fullBuild();
  }

  /** Статистика для команды и диагностики. */
  info(): { files: number; ready: boolean } {
    return this.store.stats();
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    for (const disposable of this.disposables) disposable.dispose();
    this.watcher?.dispose();
    setIndexSearchProvider(undefined);
    void this.store.flush().catch(() => undefined);
    this.store.close();
  }
}
