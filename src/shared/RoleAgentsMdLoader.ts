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
 * Только файлы с префиксом \d{2}- (01-architect, 02-coder) попадают в цепочку.
 * Файлы без префикса — доступны только для delegate_to_agent.
 * Если файлов с префиксом нет — fallback (architect, coder, reviewer).
 */
export function loadOrchestratorRoles(): AgentRole[] {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return getFallbackRoles();

    const agentsDir = path.join(workspaceFolder.uri.fsPath, '.llma', 'agents');
    if (!fs.existsSync(agentsDir)) return getFallbackRoles();

    const entries = fs.readdirSync(agentsDir);
    const chainedFiles = entries
      .filter(f => f.endsWith('.md') && /^\d{2}-/.test(f))
      .sort();

    if (chainedFiles.length === 0) return getFallbackRoles();

    return chainedFiles.map(fileName => {
      const roleName = fileName.replace(/\.md$/, '');
      const filePath = path.join(agentsDir, fileName);
      const systemPrompt = tryReadFile(filePath) || `Ты — ${roleName}. Отвечай кратко, по-русски.`;
      return { name: roleName, systemPrompt };
    });
  } catch {
    return getFallbackRoles();
  }
}

/**
 * Возвращает ВСЕ роли из .llma/agents/ для делегирования.
 * Используется delegate_to_agent: может вызвать любую роль, не только из цепочки.
 */
export function loadAllAgentRoles(): AgentRole[] {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return [];

    const agentsDir = path.join(workspaceFolder.uri.fsPath, '.llma', 'agents');
    if (!fs.existsSync(agentsDir)) return [];

    const entries = fs.readdirSync(agentsDir);
    return entries
      .filter(f => f.endsWith('.md'))
      .map(fileName => {
        const roleName = fileName.replace(/\.md$/, '');
        const filePath = path.join(agentsDir, fileName);
        const systemPrompt = tryReadFile(filePath) || `Ты — ${roleName}. Отвечай кратко, по-русски.`;
        return { name: roleName, systemPrompt };
      });
  } catch {
    return [];
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
