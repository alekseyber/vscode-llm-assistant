// RoleAgentsMdLoader — загрузка правил для ролевых воркеров (задача MA-5)
// Приоритет: .llma/agents/{role}.md → .llma/main.md → null
// Также содержит сканирование директории для динамических ролей @orchestrate

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentRole } from '../modes/apply/AgentWorker';

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

/**
 * Сканирует .llma/agents/*.md и возвращает список ролей для @orchestrate.
 * Порядок: по имени файла (префикс 01-, 02- и т.д. для управления порядком).
 * Если файлов нет — возвращает fallback-роли (architect, coder, reviewer).
 */
export function loadOrchestratorRoles(): AgentRole[] {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return getFallbackRoles();

    const agentsDir = path.join(workspaceFolder.uri.fsPath, '.llma', 'agents');
    if (!fs.existsSync(agentsDir)) return getFallbackRoles();

    const entries = fs.readdirSync(agentsDir);
    const mdFiles = entries
      .filter(f => f.endsWith('.md'))
      .sort(); // Алфавитная сортировка → префиксный порядок

    if (mdFiles.length === 0) return getFallbackRoles();

    return mdFiles.map(fileName => {
      const roleName = fileName.replace(/\.md$/, '');
      const filePath = path.join(agentsDir, fileName);
      const systemPrompt = tryReadFile(filePath) || `Ты — ${roleName}. Отвечай кратко, по-русски.`;
      return { name: roleName, systemPrompt };
    });
  } catch {
    return getFallbackRoles();
  }
}

/** Fallback-роли, если .llma/agents/ пуст или отсутствует */
function getFallbackRoles(): AgentRole[] {
  return [
    { name: 'architect', systemPrompt: 'Ты — архитектор. Спроектируй решение, опиши структуру. Отвечай кратко, по-русски.' },
    { name: 'coder', systemPrompt: 'Ты — программист. Напиши код по спецификации. Отвечай кратко, по-русски.' },
    { name: 'reviewer', systemPrompt: 'Ты — ревьюер. Проверь код, найди ошибки, предложи улучшения. Отвечай кратко, по-русски.' },
  ];
}

function tryReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content || null;
  } catch { return null; }
}

export function invalidateRoleCache(): void { roleCache.clear(); }
