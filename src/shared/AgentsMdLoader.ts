// AgentsMdLoader — правила проекта из стандартных файлов агентских инструментов.
//
// Читаем в порядке приоритета: AGENTS.md (стандарт Codex/Cursor/Cline) →
// .llma/main.md (собственный формат плагина) → CLAUDE.md (Claude Code).
// Раньше читался только .llma/main.md, хотя в промпт правило попадало с подписью
// «AGENTS.md»: человек с настоящим AGENTS.md видел, что его правила молча игнорируются.

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Порядок важен: первый найденный — самый приоритетный. */
const SOURCES = ['AGENTS.md', '.llma/main.md', 'CLAUDE.md'];

/** Лимит на всю склеенную инструкцию — иначе system prompt молча раздувается. */
const DEFAULT_MAX_CHARS = 12_000;

export interface RulesSource {
  /** Путь относительно корня рабочего пространства. */
  file: string;
  /** Сколько знаков попало в промпт из этого файла. */
  chars: number;
  /** Файл обрезан лимитом. */
  truncated?: boolean;
}

let cachedContent: string | null = null;
let cachedKey: string | null = null;
let lastSources: RulesSource[] = [];
let watcherInitialized = false;

/** Источники последнего успешного чтения — для команды «Показать источники правил». */
export function getRulesSources(): RulesSource[] {
  return lastSources;
}

export async function loadAgentsMd(): Promise<string | null> {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  if (!config.get<boolean>('agentsMd.enabled', true)) {
    return null;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return null;

  // Невалидная настройка (false, 0, строка) не должна обнулять правила проекта
  const rawMax = config.get<number>('agentsMd.maxChars', DEFAULT_MAX_CHARS);
  const maxChars = typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_CHARS;
  const paths = SOURCES.map((rel) => path.join(workspaceRoot, rel));

  if (!watcherInitialized) {
    setupWatcher(paths);
    watcherInitialized = true;
  }

  // Ключ кеша — набор файлов и их mtime/size: правка в любом из них должна давать
  // новую склейку, а не ждать перезапуска окна.
  const stamps: string[] = [];
  for (const abs of paths) {
    try {
      const stat = await fs.stat(abs);
      stamps.push(`${abs}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      stamps.push(`${abs}:none`);
    }
  }
  const key = stamps.join('|');
  if (cachedContent !== null && cachedKey === key) return cachedContent;

  const parts: string[] = [];
  const entries: Array<{ rel: string; body: string }> = [];
  const sources: RulesSource[] = [];
  let budget = Math.max(0, maxChars);

  for (let i = 0; i < paths.length; i += 1) {
    if (budget <= 0) break;
    let content: string;
    try {
      content = (await fs.readFile(paths[i], 'utf-8')).trim();
    } catch {
      continue;
    }
    if (!content) continue;

    const rel = SOURCES[i];
    const header = `### Источник: ${rel}`;
    const room = Math.max(0, budget - header.length - 4);
    if (room === 0) {
      sources.push({ file: rel, chars: 0, truncated: true });
      break;
    }
    const truncated = content.length > room;
    const body = truncated ? content.slice(0, room) : content;
    // Заголовок источника добавляем только при склейке: единственный файл читается
    // как есть, иначе в промпт уезжает техническая строка без пользы.
    entries.push({ rel, body });
    parts.push(`${header}\n${body}`);
    sources.push({ file: rel, chars: body.length, ...(truncated ? { truncated: true } : {}) });
    budget -= header.length + 4 + body.length;
  }

  if (parts.length === 0) {
    cachedContent = null;
    cachedKey = key;
    lastSources = [];
    return null;
  }

  const dropped = sources.some((s) => s.truncated);
  const joined = entries.length > 1 ? parts.join('\n\n') : entries[0].body;
  const merged =
    joined +
    (dropped
      ? `\n\n[…обрезано лимитом agentsMd.maxChars = ${maxChars}. Увеличьте настройку, если правила нужны целиком]`
      : '');

  cachedContent = merged;
  cachedKey = key;
  lastSources = sources;
  return merged;
}

function setupWatcher(paths: string[]): void {
  const known = new Set(paths);
  const invalidate = (): void => {
    cachedContent = null;
    cachedKey = null;
  };
  vscode.workspace.onDidChangeTextDocument((e) => {
    if (known.has(e.document.uri.fsPath)) invalidate();
  });
  vscode.workspace.onDidSaveTextDocument((doc) => {
    if (known.has(doc.uri.fsPath)) invalidate();
  });
  vscode.workspace.onDidCreateFiles((e) => {
    if (e.files.some((f) => known.has(f.fsPath))) invalidate();
  });
  vscode.workspace.onDidDeleteFiles((e) => {
    if (e.files.some((f) => known.has(f.fsPath))) invalidate();
  });
}

export function invalidateCache(): void {
  cachedContent = null;
  cachedKey = null;
  lastSources = [];
}
