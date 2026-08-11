// RoleAgentsMdLoader — загрузка правил для ролевых воркеров (задача MA-5)
// Приоритет: .llma/agents/{role}.md → .llma/main.md → null
// Также содержит сканирование директории для динамических ролей @orchestrate

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentRole } from '../modes/apply/AgentWorker';

/** Системный шаблон структуры скила — добавляется в промт каждого агента */
const SKILL_TEMPLATE = `
## Структура скила (системное требование)

При создании или обновлении скила в .llma/skills/ используй следующий формат:

---
role: <имя-роли>
version: 1.0.0
tools: [read_file, write_file, search_files, ...]
description: <краткое описание назначения скила — 1 предложение>
---

# Роль: <Название>

## Описание
Краткое описание назначения скила (1-2 предложения).

## Задача
Что делает эта роль, какие типы задач решает.

## Правила
- Конкретные инструкции по выполнению задач
- ...

## Запрещено
- Что нельзя делать этой роли
- ...
`;

/** Добавить системный шаблон к промту */
function enrichPrompt(prompt: string): string {
  return prompt + SKILL_TEMPLATE;
}

/** Получить системный шаблон структуры скила.
 *  Если передан workspacePath — добавляет каталог доступных скилов. */
export function getSkillTemplate(workspacePath?: string): string {
  let template = SKILL_TEMPLATE;

  if (workspacePath) {
    const catalog = getSkillCatalog(workspacePath);
    if (catalog.length > 0) {
      const table = catalog
        .map(s => `| ${s.name} | ${s.description} |`)
        .join('\n');
      template += `\n\n## Доступные скилы\n\n| Имя | Описание |\n|-----|----------|\n${table}\n\n**ПРАВИЛО:** если задача пользователя соответствует скилу — ПЕРВЫМ ДЕЛОМ вызови read_file(.llma/skills/<имя>.md) и строго следуй его правилам. НЕ ПРИСТУПАЙ к задаче пока не прочитал скил.`;
    }
  }

  return template;
}

/** Информация о скиле из каталога */
export interface SkillInfo {
  name: string;
  description: string;
}

/** Парсинг YAML-подобного frontmatter между ---. Допустимые ключи. */
export function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  const allowedKeys = new Set(['role', 'version', 'tools', 'description']);
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!allowedKeys.has(key)) continue;
    result[key] = line.slice(colonIdx + 1).trim();
  }
  return result;
}

/** Сканирует .llma/skills/ и возвращает каталог скилов. */
export function getSkillCatalog(workspacePath: string): SkillInfo[] {
  try {
    const skillsDir = path.join(workspacePath, '.llma', 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    const entries = fs.readdirSync(skillsDir);
    return entries
      .filter(f => f.endsWith('.md'))
      .map(fileName => {
        const filePath = path.join(skillsDir, fileName);
        const content = tryReadFile(filePath) || '';
        const fm = parseFrontmatter(content);
        const name = fm.role || fileName.replace(/\.md$/, '');
        const description = fm.description || content.replace(/^---[\s\S]*?---\n?/, '').slice(0, 80).trim();
        return { name, description };
      });
  } catch {
    return [];
  }
}

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
