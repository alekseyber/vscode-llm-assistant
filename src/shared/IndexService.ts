// IndexService — подключение локального индекса к расширению (P8, этап S3).
//
// Задачи сервиса:
//   - поднять хранилище (sqlite-wasm) для КАЖДОГО корня рабочего пространства;
//   - наполнить индексы в фоне, не блокируя активацию;
//   - отдавать выдачу инструменту `search_files` (контракт не меняется), сливая корни по рангу;
//   - держать индексы актуальными через watcher;
//   - деградировать: любая проблема → инструмент работает как раньше (ripgrep).

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as vscode from 'vscode';
import { SearchIndexStore } from './SearchIndex';
import { SearchIndexer, IndexSourceFile, SKIP_DIRS } from './SearchIndexer';
import { setIndexSearchProvider } from '../modes/apply/ToolDefinitions';

/** Исключения обхода: те же каталоги, что и в инструменте поиска. */
const SCAN_EXCLUDE = '**/{node_modules,.git,dist,out,build,coverage,.next,vendor,.vscode-test}/**';

/** Задержка склейки событий watcher: одна правка часто даёт 3–5 событий подряд. */
const WATCHER_DEBOUNCE_MS = 500;

/** Порог массовых изменений (git checkout большой ветки) — дешевле пересобрать целиком. */
const MASSIVE_CHANGES = 2000;

/**
 * Загрузить sqlite-wasm.
 *
 * Пакет ESM-only, поэтому import настоящий динамический (`new Function` не даёт TypeScript
 * превратить его в `require`). В собранном расширении файлы лежат в `dist/sqlite`
 * (копируются `scripts/copy-sqlite-assets.js`): в VSIX нет `node_modules`.
 * В dev-режиме (без пакета) работает обычное имя пакета.
 */
let sqlitePromise: Promise<any> | undefined;

async function loadSqlite(): Promise<any> {
  // Кэш на модуль: при переактивации окна WASM не поднимается второй раз (это ~900 КБ
  // и инициализация Emscripten-рантайма). Ошибку не кэшируем — следующий вызов попробует снова.
  if (!sqlitePromise) {
    sqlitePromise = (async () => {
      const dynamicImport = new Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<any>;

      const local = path.join(__dirname, 'sqlite', 'node.mjs');
      if (!fs.existsSync(local)) {
        // В собранном расширении node_modules нет: без локальной копии модуль не найдётся,
        // и без явного сообщения пользователь увидит ERR_MODULE_NOT_FOUND без причины
        throw new Error(
          `Файл индекса не найден: ${local}. Пересоберите расширение (npm run compile) — ` +
            'он копируется из @sqlite.org/sqlite-wasm.',
        );
      }
      const mod = await dynamicImport(pathToFileURL(local).href);
      return typeof mod.default === 'function' ? await mod.default() : mod;
    })().catch((error) => {
      sqlitePromise = undefined;
      throw error;
    });
  }
  return sqlitePromise;
}

/** Адаптер ФС поверх VS Code для одного корня. */
function vscodeAdapter(root: string): {
  listFiles(): Promise<IndexSourceFile[]>;
  readFile(relPath: string): Promise<Uint8Array>;
  readGitignore(): Promise<string[]>;
} {
  return {
    async listFiles(): Promise<IndexSourceFile[]> {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(root), '**/*');
      const uris = await vscode.workspace.findFiles(pattern, SCAN_EXCLUDE);
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

/** Один корень рабочего пространства: своё хранилище, индексатор и watcher. */
interface RootIndex {
  root: string;
  /** Префикс в выдаче: нужен, когда корней несколько (иначе пути неразличимы) */
  label: string;
  store: SearchIndexStore;
  indexer: SearchIndexer;
  watcher?: vscode.FileSystemWatcher;
  disposables: vscode.Disposable[];
  pending: Map<string, NodeJS.Timeout>;
  changesInWindow: number;
  windowStartedAt: number;
  rebuildTimer?: NodeJS.Timeout;
}

export class IndexService {
  /** Активный сервис и его провайдер: dispose одного сервиса не должен гасить другой */
  private static active?: { service: IndexService; provider: { search(query: string, limit?: number): any } };

  private constructor(
    private readonly roots: RootIndex[],
    private readonly onDebug: (message: string) => void,
  ) {}

  /**
   * Поднять сервис по всем корням. `undefined` — индекса нет ни для одного корня.
   * Активация не ждёт сборки: она идёт в фоне.
   */
  static async start(
    context: vscode.ExtensionContext,
    onDebug: (message: string) => void,
  ): Promise<IndexService | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return undefined;

    let sqlite3: any;
    try {
      sqlite3 = await loadSqlite();
    } catch (error: any) {
      onDebug(`[index] sqlite-wasm не загрузился: ${error?.message ?? String(error)}`);
      return undefined;
    }

    const roots: RootIndex[] = [];
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      try {
        const hash = crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
        const indexPath = path.join(context.globalStorageUri.fsPath, 'index', `${hash}.sqlite`);
        const store = new SearchIndexStore(sqlite3, { indexPath, onDebug });
        if (!(await store.init())) {
          onDebug(`[index] корень ${root}: хранилище недоступно, пропускаем`);
          continue;
        }
        roots.push({
          root,
          label: folders.length > 1 ? folder.name : '',
          store,
          indexer: new SearchIndexer(store, vscodeAdapter(root), { onDebug }),
          disposables: [],
          pending: new Map(),
          changesInWindow: 0,
          windowStartedAt: Date.now(),
        });
      } catch (error: any) {
        onDebug(`[index] корень ${root} не поднялся: ${error?.message ?? String(error)}`);
      }
    }

    if (roots.length === 0) return undefined;

    const service = new IndexService(roots, onDebug);
    const provider = {
      // Слияние корней: каждый отдаёт свой ранг bm25, порядок — по рангу, пути с префиксом корня
      search: (query: string, limit = 5) => {
        const merged: Array<{ path: string; rank: number; snippet?: string }> = [];
        for (const entry of roots) {
          for (const hit of entry.store.search(query, limit)) {
            merged.push({ ...hit, path: entry.label ? `${entry.label}/${hit.path}` : hit.path });
          }
        }
        return merged.sort((a, b) => a.rank - b.rank).slice(0, Math.max(1, limit));
      },
    };
    setIndexSearchProvider(provider);
    IndexService.active = { service, provider };

    // Сборка идёт ДО watcher: иначе файл, изменённый во время обхода, будет перезаписан
    // устаревшими данными, когда сборка закончится
    for (const entry of roots) {
      void service.warmUp(entry).finally(() => service.startWatcher(entry));
    }
    return service;
  }

  /** Полная сборка на первом запуске, сверка — на последующих. */
  private async warmUp(entry: RootIndex): Promise<void> {
    try {
      const isEmpty = entry.store.stats().files === 0;
      const stats = isEmpty ? await entry.indexer.fullBuild() : await entry.indexer.reconcile();
      this.onDebug(
        `[index] ${entry.label || entry.root}: ${isEmpty ? 'сборка' : 'сверка'} — ` +
          `проиндексировано ${stats.indexed}, пропущено ${stats.skipped}, удалено ${stats.removed}`,
      );
    } catch (error: any) {
      this.onDebug(`[index] ${entry.root}: фоновая сборка не удалась: ${error?.message ?? String(error)}`);
    }
  }

  /** Watcher: изменения обновляют один файл, серия быстрых изменений — одну пересборку. */
  private startWatcher(entry: RootIndex): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(entry.root), '**/*'),
    );
    entry.watcher = watcher;

    const schedule = (uri: vscode.Uri, kind: 'change' | 'delete' | 'create'): void => {
      const relPath = path.relative(entry.root, uri.fsPath).replace(/\\/g, '/');
      if (!relPath || relPath.startsWith('..')) return;
      // Обход эти каталоги исключает, но watcher видит всё: без проверки изменения
      // в node_modules дёргали бы индексатор
      if (relPath.split('/').some((segment) => SKIP_DIRS.has(segment))) return;

      if (Date.now() - entry.windowStartedAt > 60_000) {
        entry.changesInWindow = 0;
        entry.windowStartedAt = Date.now();
      }
      entry.changesInWindow += 1;
      if (entry.changesInWindow > MASSIVE_CHANGES) {
        entry.changesInWindow = 0;
        entry.windowStartedAt = Date.now();
        this.scheduleFullRebuild(entry);
        return;
      }

      const existing = entry.pending.get(relPath);
      if (existing) clearTimeout(existing);
      entry.pending.set(
        relPath,
        setTimeout(() => {
          entry.pending.delete(relPath);
          void this.applyChange(entry, relPath, kind);
        }, WATCHER_DEBOUNCE_MS),
      );
    };

    entry.disposables.push(watcher.onDidChange((uri) => schedule(uri, 'change')));
    entry.disposables.push(watcher.onDidCreate((uri) => schedule(uri, 'create')));
    entry.disposables.push(watcher.onDidDelete((uri) => schedule(uri, 'delete')));
  }

  private async applyChange(entry: RootIndex, relPath: string, kind: 'change' | 'delete' | 'create'): Promise<void> {
    if (kind === 'delete') {
      entry.indexer.removeFile(relPath);
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(path.join(entry.root, relPath)));
      await entry.indexer.updateFile({ relPath, size: stat.size, mtime: stat.mtime });
    } catch {
      // Файл успел исчезнуть (create → delete) — из индекса его надо убрать, а не ругаться
      entry.indexer.removeFile(relPath);
    }
  }

  private scheduleFullRebuild(entry: RootIndex): void {
    if (entry.rebuildTimer) clearTimeout(entry.rebuildTimer);
    entry.rebuildTimer = setTimeout(() => {
      entry.rebuildTimer = undefined;
      void this.rebuild();
    }, 5_000);
  }

  /** Пересобрать все индексы (команда и массовые изменения). */
  async rebuild(): Promise<void> {
    this.onDebug('[index] полная пересборка по запросу');
    for (const entry of this.roots) {
      await entry.indexer.fullBuild();
    }
  }

  /** Суммарная статистика по корням. */
  info(): { files: number; ready: boolean } {
    const files = this.roots.reduce((sum, entry) => sum + entry.store.stats().files, 0);
    return { files, ready: this.roots.some((entry) => entry.store.stats().ready) };
  }

  dispose(): void {
    for (const entry of this.roots) {
      for (const timer of entry.pending.values()) clearTimeout(timer);
      entry.pending.clear();
      if (entry.rebuildTimer) clearTimeout(entry.rebuildTimer);
      for (const disposable of entry.disposables) disposable.dispose();
      entry.watcher?.dispose();
      void entry.store.flush().catch(() => undefined);
      entry.store.close();
    }
    // Отключаем провайдер только если он наш: при переактивации окна сервисов может быть два
    if (IndexService.active?.service === this) {
      setIndexSearchProvider(undefined);
      IndexService.active = undefined;
    }
  }
}
