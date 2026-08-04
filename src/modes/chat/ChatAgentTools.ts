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

export const CHAT_AGENT_TOOLS: ChatTool[] = [readFileTool, writeFileTool, replaceInFileTool];

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
