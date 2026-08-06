// AgentsMdLoader — загрузчик правил главного агента из .llma/main.md
// Кеширует содержимое и инвалидирует кеш при изменении/создании/удалении файла
// Используется ChatViewProvider и ConversationManager для автоинжекта правил

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

let cachedContent: string | null = null;
let lastFilePath: string | null = null;
let watcherInitialized = false;

export async function loadAgentsMd(): Promise<string | null> {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  if (!config.get<boolean>('agentsMd.enabled', true)) {
    return null;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return null;

  const mainPath = path.join(workspaceRoot, '.llma', 'main.md');

  if (!watcherInitialized) {
    setupWatcher(mainPath);
    watcherInitialized = true;
  }

  if (cachedContent !== null && lastFilePath === mainPath) return cachedContent;

  try {
    const content = await fs.readFile(mainPath, 'utf-8');
    cachedContent = content || null;
    lastFilePath = mainPath;
    return cachedContent;
  } catch {
    cachedContent = null;
    lastFilePath = mainPath;
    return null;
  }
}

function setupWatcher(mainPath: string): void {
  vscode.workspace.onDidChangeTextDocument((e) => {
    if (lastFilePath && e.document.uri.fsPath === lastFilePath) cachedContent = null;
  });
  vscode.workspace.onDidCreateFiles((e) => {
    if (e.files.some((f) => f.fsPath === mainPath)) cachedContent = null;
  });
  vscode.workspace.onDidDeleteFiles((e) => {
    if (e.files.some((f) => f.fsPath === mainPath)) cachedContent = null;
  });
}

export function invalidateCache(): void {
  cachedContent = null;
  lastFilePath = null;
}
