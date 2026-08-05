// ToolAllowList — фильтрация инструментов по списку разрешённых (слой 02 Tool Contracts)
// Загружает конфигурацию из двух источников (приоритет — workspace):
//   1. .vscode/llm-assistant.json в корне workspace
//   2. Глобальные настройки VS Code: llmAssistant.apply.allowedTools / requireConfirmation
// Используется в ChatAgentTools (чат-агент) и AgentController (apply mode).

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** Конфигурация allow-list инструментов */
export interface ToolAllowListConfig {
  /** Список имён разрешённых инструментов. undefined = все разрешены */
  allowedTools?: string[];
  /** Список инструментов, требующих подтверждения пользователя */
  requireConfirmation?: string[];
}

/** Все возможные имена инструментов (для справки и валидации) */
export const ALL_TOOL_NAMES = [
  'read_file',
  'write_file',
  'replace_in_file',
  'patch_file',
  'list_files',
  'search_files',
  'run_terminal',
];

/** Конфиг по умолчанию: все инструменты разрешены, опасные требуют подтверждения */
export const DEFAULT_CONFIG: ToolAllowListConfig = {
  requireConfirmation: ['write_file', 'replace_in_file', 'run_terminal'],
};

/**
 * Загрузить конфигурацию allow-list из двух источников:
 * 1. .vscode/llm-assistant.json в корне workspace (приоритет)
 * 2. Глобальные настройки VS Code llmAssistant.apply.* (fallback)
 *
 * @returns объединённая конфигурация
 */
export function loadToolAllowListConfig(): ToolAllowListConfig {
  // Источник 1: .vscode/llm-assistant.json (приоритет над глобальными настройками)
  const workspaceConfig = loadWorkspaceConfig();
  if (workspaceConfig) {
    return {
      allowedTools: workspaceConfig.allowedTools ?? undefined,
      requireConfirmation: workspaceConfig.requireConfirmation ?? DEFAULT_CONFIG.requireConfirmation,
    };
  }

  // Источник 2: глобальные настройки VS Code
  const vsConfig = vscode.workspace.getConfiguration('llmAssistant');
  const allowedTools = vsConfig.get<string[]>('apply.allowedTools');
  const requireConfirmation = vsConfig.get<string[]>('apply.requireConfirmation');

  return {
    allowedTools: allowedTools && allowedTools.length > 0 ? allowedTools : undefined,
    requireConfirmation: requireConfirmation ?? DEFAULT_CONFIG.requireConfirmation,
  };
}

/**
 * Прочитать конфиг из .vscode/llm-assistant.json в корне workspace.
 * Формат файла:
 *   { "allowedTools": [...], "requireConfirmation": [...] }
 *
 * @returns конфиг из файла или null если файла нет / невалидный JSON
 */
function loadWorkspaceConfig(): ToolAllowListConfig | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }

  const configPath = path.join(folder.uri.fsPath, '.vscode', 'llm-assistant.json');
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Валидация: поля должны быть массивами строк
    return {
      allowedTools: Array.isArray(parsed.allowedTools)
        ? parsed.allowedTools.filter((t: unknown): t is string => typeof t === 'string')
        : undefined,
      requireConfirmation: Array.isArray(parsed.requireConfirmation)
        ? parsed.requireConfirmation.filter((t: unknown): t is string => typeof t === 'string')
        : undefined,
    };
  } catch {
    // Файл не существует или невалидный JSON — молча пропускаем
    return null;
  }
}

/**
 * Отфильтровать инструменты по allow-list.
 * Если allowedTools не задан или пуст — возвращает все инструменты (без фильтрации).
 *
 * @param allTools — полный список инструментов
 * @param config — конфигурация allow-list
 * @returns отфильтрованный список
 */
export function getAllowedTools<T extends { name: string }>(
  allTools: readonly T[],
  config: ToolAllowListConfig,
): T[] {
  if (!config.allowedTools || config.allowedTools.length === 0) {
    return [...allTools]; // Все разрешены — обратная совместимость
  }
  const allowed = new Set(config.allowedTools);
  return allTools.filter((t) => allowed.has(t.name));
}

/**
 * Проверить, требует ли инструмент подтверждения пользователя.
 * Возвращает true если инструмент есть в списке requireConfirmation.
 *
 * @param toolName — имя инструмента
 * @param config — конфигурация allow-list
 */
export function isConfirmationRequired(
  toolName: string,
  config: ToolAllowListConfig,
): boolean {
  if (!config.requireConfirmation || config.requireConfirmation.length === 0) {
    return false;
  }
  return config.requireConfirmation.includes(toolName);
}
