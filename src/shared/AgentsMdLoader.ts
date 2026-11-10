// AgentsMdLoader — правила проекта из стандартных файлов агентских инструментов.
//
// Читаем: AGENTS.md (стандарт Codex/Cursor/Cline), .llma/main.md (собственный формат
// плагина), CLAUDE.md (Claude Code). Склеиваем в этом порядке с подписями источников.
// Раньше читался только .llma/main.md, хотя в промпт правило попадало с подписью
// «AGENTS.md»: человек с настоящим AGENTS.md видел, что его правила молча игнорируются.

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Порядок важен: чем выше в списке, тем раньше файл попадает в склейку. */
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

/** Источники последнего успешного чтения — для команды «Показать источники правил». */
export function getRulesSources(): RulesSource[] {
  return lastSources;
}

/**
 * Корень, к которому относятся правила: папка активного редактора, если он внутри
 * рабочего пространства, иначе первый корень. В multi-root правила берём у того
 * проекта, в котором человек сейчас работает, а не у первого по списку.
 */
function resolveRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return undefined;
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (activeFile) {
    const byActive = folders.find((f) =>
      activeFile === f.uri.fsPath || activeFile.startsWith(f.uri.fsPath + path.sep));
    if (byActive) return byActive.uri.fsPath;
  }
  return folders[0].uri.fsPath;
}

/**
 * Обрезать текст по границе строки, не разрывая слово и суррогатную пару.
 * Резка посреди строки кода ломает правило, резка посреди emoji — даёт битый символ.
 */
export function truncateAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > limit * 0.6) return slice.slice(0, lastNewline);
  // Без переносов режем по кодовым точкам: суррогатная пара не разрубается
  return Array.from(slice).slice(0, -1).join('');
}

export async function loadAgentsMd(): Promise<string | null> {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  if (!config.get<boolean>('agentsMd.enabled', true)) {
    return null;
  }

  const workspaceRoot = resolveRoot();
  if (!workspaceRoot) return null;

  // Невалидная настройка (false, 0, строка) не должна обнулять правила проекта
  const rawMax = config.get<number>('agentsMd.maxChars', DEFAULT_MAX_CHARS);
  const maxChars = typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_CHARS;
  const paths = SOURCES.map((rel) => path.join(workspaceRoot, rel));

  // Кеш сверяем по СОДЕРЖИМОМУ, а не по mtime/size: на быстрых правках (и на ФС
  // с грубым mtime) одинаковый размер и та же миллисекунда давали ложное попадание
  // в кеш — пользователь видел старые правила до перезапуска окна.
  const raw: string[] = [];
  for (const abs of paths) {
    try {
      raw.push((await fs.readFile(abs, 'utf-8')).trim());
    } catch {
      raw.push('');
    }
  }
  const key = `max=${maxChars}|` + raw.map((text) => `${text.length}:${text}`).join('|');
  if (cachedContent !== null && cachedKey === key) return cachedContent;

  const chunks: string[] = [];
  const sources: RulesSource[] = [];
  let budget = Math.max(0, maxChars);

  for (let i = 0; i < paths.length; i += 1) {
    if (budget <= 0) break;
    const content = raw[i];
    if (!content) continue;

    const rel = SOURCES[i];
    const header = `### Источник: ${rel}`;
    const overhead = header.length + 1; // заголовок и перевод строки после него
    if (budget <= overhead) {
      sources.push({ file: rel, chars: 0, truncated: true });
      budget = 0;
      break;
    }
    const room = budget - overhead;
    const truncated = content.length > room;
    const body = truncated ? truncateAtBoundary(content, room) : content;
    const chunk = `${header}\n${body}`;
    chunks.push(chunk);
    sources.push({ file: rel, chars: body.length, ...(truncated ? { truncated: true } : {}) });
    // Считаем ровно то, что уходит в промпт
    budget -= chunk.length;
  }

  if (chunks.length === 0) {
    cachedContent = null;
    cachedKey = key;
    lastSources = [];
    return null;
  }

  const dropped = sources.some((s) => s.truncated);
  // Заголовок источника нужен только при склейке: единственный файл читается как есть
  const joined = chunks.length > 1
    ? chunks.join('\n\n')
    : chunks[0].slice(chunks[0].indexOf('\n') + 1);
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

/** Сброс кеша: тесты и команда «Обновить правила». */
export function invalidateCache(): void {
  cachedContent = null;
  cachedKey = null;
  lastSources = [];
}
