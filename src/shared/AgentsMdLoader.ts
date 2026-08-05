// AgentsMdLoader — загрузчик AGENTS.md из корня workspace
// Кеширует содержимое и инвалидирует кеш при изменении/создании/удалении файла
// Используется AgentController, ChatViewProvider и ConversationManager для автоинжекта правил

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Закешированное содержимое AGENTS.md */
let cachedContent: string | null = null;

/** Путь к последнему загруженному файлу (для инвалидации) */
let lastFilePath: string | null = null;

/** Флаг: подписались ли на события изменения файлов */
let watcherInitialized = false;

/**
 * Загрузить содержимое AGENTS.md из корня workspace.
 *
 * - Если настройка llmAssistant.agentsMd.enabled === false, сразу возвращает null
 * - Если файла нет в корне workspace — возвращает null
 * - При первом вызове подписывается на onDidChangeTextDocument,
 *   onDidCreateFiles, onDidDeleteFiles для инвалидации кеша
 * - Кеширует содержимое до следующего изменения файла или смены workspace
 *
 * @returns содержимое AGENTS.md или null
 */
export async function loadAgentsMd(): Promise<string | null> {
  // Проверяем настройку — если отключено, не загружаем
  const config = vscode.workspace.getConfiguration('llmAssistant');
  if (!config.get<boolean>('agentsMd.enabled', true)) {
    return null;
  }

  // Получаем корень workspace
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return null;
  }

  const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');

  // Настраиваем слежение за файлом при первом вызове
  if (!watcherInitialized) {
    setupWatcher();
    watcherInitialized = true;
  }

  // Возвращаем кеш, если он актуален
  if (cachedContent !== null && lastFilePath === agentsMdPath) {
    return cachedContent;
  }

  // Читаем файл с диска
  try {
    const content = await fs.readFile(agentsMdPath, 'utf-8');
    cachedContent = content;
    lastFilePath = agentsMdPath;
    return content;
  } catch {
    // Файла нет или ошибка чтения — сбрасываем кеш
    cachedContent = null;
    lastFilePath = agentsMdPath;
    return null;
  }
}

/**
 * Подписаться на события VS Code для инвалидации кеша AGENTS.md:
 * - onDidChangeTextDocument — файл изменён и сохранён
 * - onDidCreateFiles — файл создан
 * - onDidDeleteFiles — файл удалён
 */
function setupWatcher(): void {
  // Изменение содержимого файла (сохранение)
  vscode.workspace.onDidChangeTextDocument((e) => {
    if (lastFilePath && e.document.uri.fsPath === lastFilePath) {
      cachedContent = null;
    }
  });

  // Создание файла (например, touch AGENTS.md)
  vscode.workspace.onDidCreateFiles((e) => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;
    const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');
    if (e.files.some((f) => f.fsPath === agentsMdPath)) {
      cachedContent = null;
    }
  });

  // Удаление файла
  vscode.workspace.onDidDeleteFiles((e) => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;
    const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');
    if (e.files.some((f) => f.fsPath === agentsMdPath)) {
      cachedContent = null;
    }
  });
}

/**
 * Сбросить кеш вручную (для тестов и при смене workspace).
 */
export function invalidateCache(): void {
  cachedContent = null;
  lastFilePath = null;
}
