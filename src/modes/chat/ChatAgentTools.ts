// ChatAgentTools — инструменты для агентного режима чата
// read_file, write_file, replace_in_file через VS Code API

import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Workspace не открыт');
  return folder.uri.fsPath;
}

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(getWorkspaceRoot(), p);
}

const readFileTool: ChatTool = {
  name: 'read_file',
  description: 'Читает содержимое файла. Возвращает текст с нумерацией строк.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к файлу относительно workspace' },
      offset: { type: 'number', description: 'Начать с этой строки (1-indexed)' },
      limit: { type: 'number', description: 'Сколько строк прочитать (по умолчанию 500)' },
    },
    required: ['path'],
  },
  async execute(args) {
    const filePath = resolvePath(args.path as string);
    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const content = new TextDecoder().decode(data);
    const lines = content.split('\n');
    const start = Math.max(1, Math.floor((args.offset as number) || 1));
    const end = Math.min(lines.length, start + Math.floor((args.limit as number) || 500) - 1);
    const selected = lines.slice(start - 1, end);
    const numbered = selected.map((l, i) => `${String(start + i).padStart(4)}| ${l}`).join('\n');
    return `Файл: ${filePath} (строк ${start}-${end} из ${lines.length})\n${numbered}`;
  },
};

const writeFileTool: ChatTool = {
  name: 'write_file',
  description: 'Записывает содержимое в файл (перезаписывает полностью). Создаёт папки при необходимости.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к файлу относительно workspace' },
      content: { type: 'string', description: 'Полное содержимое файла' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const filePath = resolvePath(args.path as string);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(args.content as string));
    return `Файл записан: ${filePath} (${(args.content as string).length} символов)`;
  },
};

const replaceInFileTool: ChatTool = {
  name: 'replace_in_file',
  description: 'Заменяет old_str на new_str в файле. Только первое вхождение.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к файлу относительно workspace' },
      old_str: { type: 'string', description: 'Текст для замены' },
      new_str: { type: 'string', description: 'Новый текст' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  async execute(args) {
    const filePath = resolvePath(args.path as string);
    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const content = new TextDecoder().decode(data);
    const oldStr = args.old_str as string;
    if (!content.includes(oldStr)) return `Ошибка: текст для замены не найден в ${filePath}`;
    const updated = content.replace(oldStr, args.new_str as string);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(updated));
    return `Файл обновлён: ${filePath}`;
  },
};

const listFilesTool: ChatTool = {
  name: 'list_files',
  description: 'Показывает список файлов и папок в директории (рекурсивно до depth уровней).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Путь к папке относительно workspace (по умолчанию корень)' },
      depth: { type: 'number', description: 'Глубина рекурсии (1-3, по умолчанию 2)' },
    },
    required: [],
  },
  async execute(args) {
    const dirPath = resolvePath((args.path as string) || '.');
    const depth = Math.min(Math.max(1, Math.floor((args.depth as number) || 2)), 3);
    const result: string[] = [];
    await listDir(dirPath, '', depth, result);
    return result.join('\n') || '(пустая директория)';
  },
};

async function listDir(dirPath: string, prefix: string, depth: number, result: string[]): Promise<void> {
  if (depth <= 0) return;
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
    // Сортируем: папки сверху, потом файлы
    entries.sort((a, b) => {
      const aIsDir = a[1] === vscode.FileType.Directory ? 0 : 1;
      const bIsDir = b[1] === vscode.FileType.Directory ? 0 : 1;
      return aIsDir - bIsDir || a[0].localeCompare(b[0]);
    });
    for (const [name, fileType] of entries) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const isDir = fileType === vscode.FileType.Directory;
      result.push(`${prefix}${isDir ? '📁' : '📄'} ${name}`);
      if (isDir) {
        await listDir(path.join(dirPath, name), prefix + '  ', depth - 1, result);
      }
    }
  } catch { /* skip inaccessible */ }
}

const searchFilesTool: ChatTool = {
  name: 'search_files',
  description: 'Ищет файлы по имени или тексту внутри. Использует regex. Возвращает совпадения с номерами строк.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Поисковый запрос (regex)' },
      path: { type: 'string', description: 'Путь к папке (по умолчанию корень)' },
      file_glob: { type: 'string', description: 'Фильтр файлов, например *.ts' },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || '.';
    const fileGlob = (args.file_glob as string) || '**/*';
    const root = getWorkspaceRoot();
    const searchDir = path.isAbsolute(searchPath) ? searchPath : path.join(root, searchPath);

    let regex: RegExp;
    try { regex = new RegExp(pattern); } catch { return `Ошибка: невалидное regex '${pattern}'`; }

    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(searchDir, fileGlob),
      '**/node_modules/**',
      200
    );

    const matches: string[] = [];
    for (const fileUri of files) {
      const fileName = path.basename(fileUri.fsPath);
      if (regex.test(fileName)) matches.push(`📄 ${fileUri.fsPath}`);
      try {
        const data = await vscode.workspace.fs.readFile(fileUri);
        const content = new TextDecoder().decode(data);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push(`${fileUri.fsPath}:${i + 1}: ${lines[i].trim().slice(0, 150)}`);
            if (matches.length >= 100) break;
          }
        }
      } catch { /* binary */ }
      if (matches.length >= 100) break;
    }
    return matches.length > 0 ? matches.join('\n') : `Ничего не найдено по '${pattern}'`;
  },
};

export const CHAT_AGENT_TOOLS: ChatTool[] = [readFileTool, writeFileTool, replaceInFileTool, listFilesTool, searchFilesTool];

/** OpenAI function calling формат */
export function getToolSchemas(): Array<Record<string, unknown>> {
  return CHAT_AGENT_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function getTool(name: string): ChatTool | undefined {
  return CHAT_AGENT_TOOLS.find(t => t.name === name);
}
