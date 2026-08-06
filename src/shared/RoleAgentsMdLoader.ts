// RoleAgentsMdLoader — загрузка правил для ролевых воркеров (задача MA-5)
// Приоритет: .llma/agents/{role}.md → .llma/main.md → null

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const roleCache = new Map<string, string | null>();

export function loadRoleAgentsMd(roleName: string): string | null {
  const cacheKey = `role:${roleName}`;
  if (roleCache.has(cacheKey)) return roleCache.get(cacheKey) ?? null;

  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { roleCache.set(cacheKey, null); return null; }

    const rootPath = workspaceFolder.uri.fsPath;

    // 1. .llma/agents/{role}.md
    const roleFile = path.join(rootPath, '.llma', 'agents', `${roleName}.md`);
    const roleContent = tryReadFile(roleFile);
    if (roleContent) { roleCache.set(cacheKey, roleContent); return roleContent; }

    // 2. .llma/main.md — fallback
    const mainFile = path.join(rootPath, '.llma', 'main.md');
    const mainContent = tryReadFile(mainFile);
    const result = mainContent || null;
    roleCache.set(cacheKey, result);
    return result;
  } catch {
    roleCache.set(cacheKey, null);
    return null;
  }
}

function tryReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content || null;
  } catch { return null; }
}

export function invalidateRoleCache(): void { roleCache.clear(); }
