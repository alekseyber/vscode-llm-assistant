// AgentsMdLoader — загрузчик правил главного агента из .llma/main.md или AGENTS.md
// Приоритет: .llma/main.md → AGENTS.md → null
// Кеширует содержимое и инвалидирует кеш при изменении/создании/удалении файлов
// Используется ChatViewProvider и ConversationManager для автоинжекта правил

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Закешированное содержимое */
let cachedContent: string | null = null;

/** Путь к последнему загруженному файлу (для инвалидации) */
let lastFilePath: string | null = null;

/** Флаг: подписались ли на события изменения файлов */
let watcherInitialized = false;

/**
 * Загрузить правила главного агента.
 *
 * Приоритет:
 *   1. .llma/main.md     (основной путь)
 *   2. AGENTS.md         (корень, обратная совместимость)
 *
 * @returns содержимое файла или null
 */
export async function loadAgentsMd(): Promise<string | null> {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  if (!config.get<boolean>('agentsMd.enabled', true)) {
    return null;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return null;
  }

  if (!watcherInitialized) {
    setupWatcher(workspaceRoot);
    watcherInitialized = true;
  }

  // 1. Пробуем .llma/main.md
  const mainPath = path.join(workspaceRoot, '.llma', 'main.md');
  const mainContent = await tryReadFile(mainPath);
  if (mainContent !== null) {
    if (cachedContent === mainContent && lastFilePath === mainPath) return cachedContent;
    cachedContent = mainContent;
    lastFilePath = mainPath;
    return mainContent;
  }

  // 2. Fallback: AGENTS.md
  const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');
  if (cachedContent !== null && lastFilePath === agentsMdPath) {
    return cachedContent;
  }
  const rootContent = await tryReadFile(agentsMdPath);
  cachedContent = rootContent;
  lastFilePath = agentsMdPath;
  return rootContent;
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content || null;
  } catch {
    return null;
  }
}

function setupWatcher(workspaceRoot: string): void {
  const mainPath = path.join(workspaceRoot, '.llma', 'main.md');
  const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');

  const isTracked = (uri: vscode.Uri) =>
    uri.fsPath === mainPath || uri.fsPath === agentsMdPath;

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (lastFilePath && e.document.uri.fsPath === lastFilePath) {
      cachedContent = null;
    }
  });

  vscode.workspace.onDidCreateFiles((e) => {
    if (e.files.some((f) => isTracked(f))) {
      cachedContent = null;
    }
  });

  vscode.workspace.onDidDeleteFiles((e) => {
    if (e.files.some((f) => isTracked(f))) {
      cachedContent = null;
    }
  });
}

export function invalidateCache(): void {
  cachedContent = null;
  lastFilePath = null;
}
