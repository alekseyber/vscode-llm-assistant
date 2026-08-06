// RoleAgentsMdLoader — загрузка AGENTS.{role}.md для ролевых воркеров (задача MA-5)
// Приоритет: AGENTS.{role}.md → AGENTS.md → null

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** Кеш: role → содержимое файла или null (файл не найден) */
const roleCache = new Map<string, string | null>();

/**
 * Загрузить AGENTS.md для конкретной роли.
 * Ищет AGENTS.{role}.md в корне workspace.
 * Если не найден — возвращает AGENTS.md.
 *
 * @param roleName — имя роли (coder, reviewer, architect)
 * @returns содержимое файла или null
 */
export function loadRoleAgentsMd(roleName: string): string | null {
  // Проверяем кеш
  const cacheKey = `role:${roleName}`;
  if (roleCache.has(cacheKey)) {
    return roleCache.get(cacheKey) ?? null;
  }

  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      roleCache.set(cacheKey, null);
      return null;
    }

    const rootPath = workspaceFolder.uri.fsPath;

    // 1. Пробуем AGENTS.{role}.md
    const roleFile = path.join(rootPath, `AGENTS.${roleName}.md`);
    if (fs.existsSync(roleFile)) {
      const content = fs.readFileSync(roleFile, 'utf-8').trim();
      if (content) {
        roleCache.set(cacheKey, content);
        return content;
      }
    }

    // 2. Fallback: AGENTS.md
    const defaultFile = path.join(rootPath, 'AGENTS.md');
    if (fs.existsSync(defaultFile)) {
      const content = fs.readFileSync(defaultFile, 'utf-8').trim();
      const result = content || null;
      roleCache.set(cacheKey, result);
      return result;
    }

    roleCache.set(cacheKey, null);
    return null;
  } catch {
    roleCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Сбросить кеш для всех ролей.
 */
export function invalidateRoleCache(): void {
  roleCache.clear();
}
