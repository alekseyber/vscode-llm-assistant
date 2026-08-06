// RoleAgentsMdLoader — загрузка правил для ролевых воркеров (задача MA-5)
// Приоритет: .llma/agents/{role}.md → AGENTS.{role}.md → .llma/main.md → AGENTS.md → null

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** Кеш: role → содержимое файла или null (файл не найден) */
const roleCache = new Map<string, string | null>();

/**
 * Загрузить правила для конкретной роли агента.
 *
 * Приоритет поиска:
 *   1. .llma/agents/{role}.md  (папка плагина в корне проекта)
 *   2. AGENTS.{role}.md        (корень проекта, обратная совместимость)
 *   3. AGENTS.md               (общие правила)
 *   4. null                    (ничего не найдено)
 *
 * @param roleName — имя роли (coder, reviewer, architect)
 * @returns содержимое файла или null
 */
export function loadRoleAgentsMd(roleName: string): string | null {
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

    // 1. .llma/agents/{role}.md — основной путь
    const llmaRoleFile = path.join(rootPath, '.llma', 'agents', `${roleName}.md`);
    const content = tryReadFile(llmaRoleFile);
    if (content) {
      roleCache.set(cacheKey, content);
      return content;
    }

    // 2. AGENTS.{role}.md — обратная совместимость
    const rootRoleFile = path.join(rootPath, `AGENTS.${roleName}.md`);
    const rootContent = tryReadFile(rootRoleFile);
    if (rootContent) {
      roleCache.set(cacheKey, rootContent);
      return rootContent;
    }

    // 3. .llma/main.md — правила главного агента
    const mainFile = path.join(rootPath, '.llma', 'main.md');
    const mainContent = tryReadFile(mainFile);
    if (mainContent) {
      roleCache.set(cacheKey, mainContent);
      return mainContent;
    }

    // 4. AGENTS.md — общие правила (корень)
    const defaultFile = path.join(rootPath, 'AGENTS.md');
    const defaultContent = tryReadFile(defaultFile);
    const result = defaultContent || null;
    roleCache.set(cacheKey, result);
    return result;
  } catch {
    roleCache.set(cacheKey, null);
    return null;
  }
}

/** Прочитать файл, вернуть trimmed содержимое или null */
function tryReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * Сбросить кеш для всех ролей.
 */
export function invalidateRoleCache(): void {
  roleCache.clear();
}
