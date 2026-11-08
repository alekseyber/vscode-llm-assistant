// Определения 5 инструментов для Apply Mode с JSON Schema (function calling API)
// Инструменты работают с файловой системой workspace через VS Code API:
// read_file, write_file, patch_file, search_files, run_terminal

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { TextDecoder, TextEncoder } from 'util';
import { Tool } from './ToolSystem';
import { wrapExternalContent } from '../../shared/promptGuard';

// --- Типы аргументов инструментов ---

/** Аргументы read_file: чтение файла с offset/limit по строкам (1-indexed) */
export interface ReadFileArgs {
  /** Путь к файлу относительно workspace */
  path: string;
  /** Строка, с которой начать чтение (1-indexed, по умолчанию 1) */
  offset?: number;
  /** Сколько строк прочитать (по умолчанию 500) */
  limit?: number;
}

/** Аргументы write_file: полная перезапись файла */
export interface WriteFileArgs {
  /** Путь к файлу относительно workspace */
  path: string;
  /** Полное содержимое файла */
  content: string;
}

/** Аргументы patch_file: замена old на new в файле */
export interface PatchFileArgs {
  /** Путь к файлу относительно workspace */
  path: string;
  /** Текст, который нужно заменить */
  old: string;
  /** Новый текст */
  new: string;
  /** Заменить все вхождения (по умолчанию false — только первое) */
  replace_all?: boolean;
}

/** Аргументы search_files: поиск по имени файла или по содержимому */
export interface SearchFilesArgs {
  /** Поисковый запрос (regex) */
  pattern: string;
  /** Путь к папке для поиска (по умолчанию '.') */
  path?: string;
  /** Фильтр по типу файлов, например *.ts (по умолчанию '*') */
  file_glob?: string;
}

/** Аргументы run_terminal: выполнение команды в shell */
export interface RunTerminalArgs {
  /** Команда для выполнения */
  command: string;
  /** Рабочая папка (по умолчанию workspace) */
  workdir?: string;
  /** Максимальное время выполнения в секундах (по умолчанию 30) */
  timeout?: number;
}

// --- Вспомогательные функции работы с файловой системой ---

/**
 * Получить корневую папку workspace.
 * @returns абсолютный путь корня workspace
 * @throws если workspace не открыт
 */
function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Workspace не открыт — невозможно выполнить инструмент');
  }
  return folder.uri.fsPath;
}

/**
 * Преобразовать путь (относительный или абсолютный) в абсолютный.
 * @param relativePath — путь относительно workspace или абсолютный путь
 */
function resolvePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(getWorkspaceRoot(), relativePath);
}

/**
 * Прочитать файл как текст (UTF-8) через VS Code API.
 */
async function readFileText(filePath: string): Promise<string> {
  const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return new TextDecoder().decode(data);
}

/**
 * Записать текст в файл (UTF-8), создавая родительские папки при необходимости.
 */
async function writeFileText(filePath: string, content: string): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  // Создаём родительские папки, если их нет (writeFile не создаёт их сам)
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
}


// --- search_files: лимиты и ранжирование ---

/** Потолок числа файлов, которые просматривает поиск (было 500 — обрезало большие репозитории). */
const MAX_SCAN_FILES = 5000;
/** Сколько совпадений собираем до ранжирования. */
const MAX_COLLECT = 600;
/** Сколько совпадений отдаём модели после ранжирования. */
const MAX_MATCHES = 60;
/** Файлы больше этого размера не читаем (обычно минифицированный код и артефакты). */
const MAX_FILE_BYTES = 1_000_000;
/** Что исключаем на уровне поиска файлов. */
const SCAN_EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,build,coverage,.next,vendor,.vscode-test}/**';

export interface RankedMatch {
  text: string;
  score: number;
}

const DECLARATION_RE = /^\s*(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def|struct|impl|trait|record)\b/;

/** Оценка значимости строки-совпадения: чем «объявнее», тем выше. */
export function lineScore(line: string, fileName: string, regex: RegExp): number {
  let score = 1;
  if (DECLARATION_RE.test(line)) score += 2;
  if (regex.test(fileName)) score += 1;
  // Строка-комментарий менее интересна, чем код
  if (/^\s*(\/\/|#|\*|--)/.test(line)) score -= 1;
  return score;
}

/** Разобрать .gitignore в список простых правил (без полноценного git-синтаксиса). */
export function parseGitignore(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => l.replace(/^\//, '').replace(/\/$/, ''));
}

/** Попадает ли путь под правила .gitignore (по префиксу каталога или шаблону с *). */
export function isIgnored(relativePath: string, rules: readonly string[]): boolean {
  const p = relativePath.replace(/\\/g, '/');
  for (const rule of rules) {
    if (rule.includes('*')) {
      const rx = new RegExp('^' + rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '($|/)');
      if (rx.test(p)) return true;
      continue;
    }
    if (p === rule || p.startsWith(rule + '/') || p.includes('/' + rule + '/')) return true;
  }
  return false;
}

/** Прочитать .gitignore из корня workspace (если есть). */
async function loadGitignoreRules(root: string): Promise<string[]> {
  try {
    const text = await readFileText(path.join(root, '.gitignore'));
    return parseGitignore(text);
  } catch {
    return [];
  }
}

// --- Определения инструментов ---

/** read_file: чтение содержимого файла с нумерацией строк */
const readFileTool: Tool = {
  name: 'read_file',
  description: 'Читает содержимое файла в workspace. offset и limit опциональны.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к файлу относительно workspace' },
      offset: { type: 'number', description: 'Строка с которой начать (1-indexed)', default: 1 },
      limit: { type: 'number', description: 'Сколько строк прочитать', default: 500 }
    },
    required: ['path']
  },
  async execute(args: unknown): Promise<string> {
    const { path: filePath, offset = 1, limit = 500 } = args as ReadFileArgs;
    const absPath = resolvePath(filePath);
    const content = await readFileText(absPath);

    // Разбиваем на строки и применяем offset/limit (1-indexed)
    const lines = content.split('\n');
    const start = Math.max(1, Math.floor(offset));
    const end = Math.min(lines.length, start + Math.floor(limit) - 1);
    const selected = lines.slice(start - 1, end);

    // Нумеруем строки для удобства агента
    const numbered = selected
      .map((line, i) => `${String(start + i).padStart(4)}| ${line}`)
      .join('\n');

    return `Файл: ${absPath} (всего строк: ${lines.length}, показаны ${start}-${end})\n${numbered}`;
  }
};

/** write_file: полная перезапись файла с автосозданием папок */
const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Записывает содержимое в файл (перезаписывает). Папки создаются автоматически.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к файлу относительно workspace' },
      content: { type: 'string', description: 'Полное содержимое файла' }
    },
    required: ['path', 'content']
  },
  async execute(args: unknown): Promise<string> {
    const { path: filePath, content } = args as WriteFileArgs;
    const absPath = resolvePath(filePath);
    // Идемпотентность: та же запись повторно — не изменение файла (модель любит дублировать)
    try {
      const current = await readFileText(absPath);
      if (current === content) {
        return `Файл не изменён: содержимое уже совпадает (${absPath})`;
      }
    } catch { /* файла нет — пишем */ }
    await writeFileText(absPath, content);
    return `Файл записан: ${absPath} (${content.length} символов)`;
  }
};

/** patch_file: замена old на new (первое вхождение или все) */
const patchFileTool: Tool = {
  name: 'patch_file',
  description: 'Находит строку old и заменяет её на new в файле. Если replace_all=false — только первое вхождение.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к файлу относительно workspace' },
      old: { type: 'string', description: 'Текст который нужно заменить' },
      new: { type: 'string', description: 'Новый текст' },
      replace_all: { type: 'boolean', description: 'Заменить все вхождения', default: false }
    },
    required: ['path', 'old', 'new']
  },
  async execute(args: unknown): Promise<string> {
    const { path: filePath, old: oldText, new: newText, replace_all = false } = args as PatchFileArgs;
    const absPath = resolvePath(filePath);
    const content = await readFileText(absPath);

    if (!oldText) {
      return 'Ошибка: параметр old не может быть пустым';
    }

    // Подсчитываем количество вхождений искомого текста
    const occurrences = content.split(oldText).length - 1;
    if (occurrences === 0) {
      return `Ошибка: текст для замены не найден в файле ${absPath}`;
    }

    // replace_all=true — заменяем все вхождения, иначе только первое
    const updated = replace_all
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);

    await writeFileText(absPath, updated);
    return `Файл обновлён: ${absPath} (найдено вхождений: ${occurrences}, заменено: ${replace_all ? occurrences : 1})`;
  }
};

/** search_files: поиск по имени файла и по содержимому (regex) */
const searchFilesTool: Tool = {
  name: 'search_files',
  description: 'Ищет файлы по имени или текст внутри файлов. Использует ripgrep-like регулярные выражения.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Поисковый запрос (regex)' },
      path: { type: 'string', description: 'Путь к папке для поиска', default: '.' },
      file_glob: { type: 'string', description: 'Фильтр по типу файлов (например *.ts)', default: '*' }
    },
    required: ['pattern']
  },
  async execute(args: unknown): Promise<string> {
    const { pattern, path: searchPath = '.', file_glob = '*' } = args as SearchFilesArgs;
    const root = getWorkspaceRoot();
    const searchDir = path.isAbsolute(searchPath) ? searchPath : path.join(root, searchPath);

    // Проверяем валидность регулярного выражения
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return `Ошибка: невалидное регулярное выражение '${pattern}'`;
    }

    // Ищем файлы по glob-фильтру. Потолок поднят: раньше 500 файлов обрезали поиск
    // на реальных репозиториях и агент получал «ничего не найдено» при существующем коде.
    const globPattern = new vscode.RelativePattern(searchDir, file_glob);
    const files = await vscode.workspace.findFiles(globPattern, SCAN_EXCLUDE_GLOB, MAX_SCAN_FILES);

    const ignore = await loadGitignoreRules(root);
    const found: RankedMatch[] = [];
    let skippedByIgnore = 0;

    for (const fileUri of files) {
      const relative = path.relative(root, fileUri.fsPath) || fileUri.fsPath;
      if (isIgnored(relative, ignore)) {
        skippedByIgnore += 1;
        continue;
      }

      const fileName = path.basename(fileUri.fsPath);
      if (regex.test(fileName)) {
        found.push({ text: `ФАЙЛ: ${fileUri.fsPath}`, score: 4 });
      }

      try {
        const stat = await vscode.workspace.fs.stat?.(fileUri);
        if (stat && typeof stat.size === 'number' && stat.size > MAX_FILE_BYTES) continue;

        const content = await readFileText(fileUri.fsPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            found.push({
              text: `${fileUri.fsPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`,
              score: lineScore(lines[i], fileName, regex),
            });
            if (found.length >= MAX_COLLECT) break;
          }
        }
      } catch {
        // Пропускаем файлы, которые не удалось прочитать (бинарные, без прав)
      }

      if (found.length >= MAX_COLLECT) break;
    }

    if (found.length === 0) {
      return `По запросу '${pattern}' в '${searchDir}' (glob: ${file_glob}) ничего не найдено`;
    }

    // Ранжирование: объявления символов и совпадения в имени файла выше случайных вхождений
    found.sort((a, b) => b.score - a.score);
    const shown = found.slice(0, MAX_MATCHES).map((m) => m.text);
    const rest = found.length > shown.length ? `\n…и ещё ${found.length - shown.length} совпадений` : '';
    const ignoredNote = skippedByIgnore > 0 ? ` (${skippedByIgnore} файлов пропущено по .gitignore)` : '';
    return `Найдено совпадений: ${found.length}${ignoredNote}\n${shown.join('\n')}${rest}`;
  }
};

/** run_terminal: выполнение команды в shell с таймаутом */
const runTerminalTool: Tool = {
  name: 'run_terminal',
  description: 'Запускает команду в терминале. timeout в секундах. Команда выполняется в workspace.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Команда для выполнения' },
      workdir: { type: 'string', description: 'Рабочая папка (по умолчанию workspace)', default: '.' },
      timeout: { type: 'number', description: 'Максимальное время выполнения (сек)', default: 30 }
    },
    required: ['command']
  },
  async execute(args: unknown): Promise<string> {
    const { command, workdir = '.', timeout = 30 } = args as RunTerminalArgs;
    const root = getWorkspaceRoot();
    const cwd = path.isAbsolute(workdir) ? workdir : path.join(root, workdir);

    return new Promise<string>((resolvePromise) => {
      // exec выполняет команду в shell; timeout ограничивает время выполнения
      exec(
        command,
        { cwd, timeout: Math.max(1, Math.floor(timeout)) * 1000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const parts: string[] = [];
          if (stdout) parts.push(`[stdout]\n${stdout}`);
          if (stderr) parts.push(`[stderr]\n${stderr}`);
          if (error) {
            // Код выхода != 0 или таймаут — возвращаем как результат,
            // чтобы агент мог проанализировать ошибку и попробовать другой подход
            parts.push(`[ошибка] ${error.message}`);
          }
          resolvePromise(parts.join('\n') || '(команда завершилась без вывода)');
        }
      );
    });
  }
};

// --- web_fetch: чтение веб-страниц ---

const webFetchApplyTool: Tool = {
  name: 'web_fetch',
  description: 'Читает содержимое веб-страницы. Возвращает текст (до 15000 символов).',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL страницы для чтения' },
      selector: { type: 'string', description: 'CSS-селектор для конкретного блока (опционально)' },
    },
    required: ['url'],
  },
  async execute(args: unknown): Promise<string> {
    try {
      const a = args as { url: string; selector?: string };
      const response = await fetch(a.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'VS Code LLM Assistant/1.0' },
      });
      if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      if (!contentType.includes('html')) return text.slice(0, 15000) || '(пустая страница)';
      const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const html = bodyMatch ? bodyMatch[1] : text;
      let result = html;
      if (a.selector) {
        const esc = a.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<[^>]*\\bclass\\s*=\\s*["']${esc}["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i');
        const match = html.match(regex);
        if (match) result = match[1] || html;
      }
      result = result
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s{2,}/g, '\n')
        .trim();
      return wrapExternalContent(`web_fetch: ${a.url}`, result.slice(0, 15000)) || '(пустая страница)';
    } catch (e: any) {
      return `Ошибка: ${e.message}`;
    }
  },
};

/**
 * Создать список всех инструментов агента для регистрации в ToolSystem.
 * @returns массив из 6 инструментов
 */
export function createTools(): Tool[] {
  return [readFileTool, writeFileTool, patchFileTool, searchFilesTool, runTerminalTool, webFetchApplyTool];
}