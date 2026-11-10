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
name: <имя-скила>
version: 1.0.0
tools: [read_file, write_file, search_files, ...]
description: <краткое описание назначения скила — 1 предложение>
---

# Скил: <Название>

## Описание
Краткое описание назначения скила (1-2 предложения).

## Задача
Что делает эта роль, какие типы задач решает.

## Правила
- Конкретные инструкции по выполнению задач
- ...

## Запрещено
- Что нельзя делать этому скилу
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
      const header = '\n\n## Доступные скилы\n\n| Имя | Описание | Файл |\n|-----|----------|------|\n';
      const rows: string[] = [];
      let size = header.length;
      const cell = (value: string): string => value.replace(/\|/g, '\\|');
      for (const skill of catalog) {
        const row = `| ${cell(skill.name)} | ${cell(skill.description)} | ${cell(skill.path)} |`;
        // Каталог не должен съедать контекст: пока влезает — добавляем, дальше считаем
        if (size + row.length + 1 > MAX_CATALOG_CHARS) break;
        rows.push(row);
        size += row.length + 1;
      }
      const hidden = catalog.length - rows.length;
      const tail = hidden > 0
        ? `\n\n…каталог обрезан лимитом: не показано ${hidden} скилов из ${catalog.length}`
        : '';
      template +=
        `${header}${rows.join('\n')}${tail}\n\n` +
        '**ПРАВИЛО:** если задача пользователя соответствует скилу — ПЕРВЫМ ДЕЛОМ вызови ' +
        'read_file(<Файл> из таблицы) и строго следуй его правилам. НЕ ПРИСТУПАЙ к задаче пока не прочитал скил.' +
        (hidden > 0
          ? ' Если пользователь назвал скил, которого нет в таблице (каталог обрезан), проверь ' +
            '`.llma/skills/<имя>.md` и `.claude/skills/<имя>/SKILL.md`.'
          : '');
    }
  }

  return template;
}

/** Информация о скиле из каталога */
export interface SkillInfo {
  name: string;
  description: string;
  /** Путь относительно корня рабочего пространства — агент читает именно его. */
  path: string;
}

/** Скил-файл больше этого не читаем: это не инструкция, а свалка. */
const MAX_SKILL_FILE_BYTES = 256 * 1024;

/** Лимит на таблицу каталога в промпте: каталог не должен съедать контекст. */
const MAX_CATALOG_CHARS = 6_000;

/** Парсинг YAML-подобного frontmatter между ---. Допустимые ключи. */
export function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  const allowedKeys = new Set(['name', 'role', 'version', 'tools', 'description']);
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

/**
 * Каталог скилов из двух форматов:
 *   `.llma/skills/<имя>.md`         — собственный формат плагина;
 *   `.claude/skills/<имя>/SKILL.md` — формат Claude Code (frontmatter + тело).
 *
 * Приоритет у `.llma`: если имя совпадает, скил из `.claude` не дублируется.
 * Симлинки пропускаем: скил-файл может указывать куда угодно, а читаем мы только
 * то, что лежит внутри рабочего пространства.
 */
export function getSkillCatalog(workspacePath: string): SkillInfo[] {
  const catalog: SkillInfo[] = [];
  const seen = new Set<string>();

  const addSkill = (name: string, description: string, relPath: string): void => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    catalog.push({ name, description, path: relPath });
  };

  // 1. .llma/skills/*.md
  try {
    const skillsDir = path.join(workspacePath, '.llma', 'skills');
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const filePath = path.join(skillsDir, entry.name);
        if (entry.isSymbolicLink() || isSkippableSkillFile(filePath)) continue;
        const content = tryReadFile(filePath) || '';
        const fm = parseFrontmatter(content);
        const name = fm.name || fm.role || entry.name.replace(/\.md$/, '');
        const description = fm.description || stripFrontmatter(content).slice(0, 80).trim();
        addSkill(name, description, `.llma/skills/${entry.name}`);
      }
    }
  } catch {
    /* нет каталога — это нормально */
  }

  // 2. .claude/skills/<имя>/SKILL.md
  try {
    const claudeDir = path.join(workspacePath, '.claude', 'skills');
    if (fs.existsSync(claudeDir)) {
      for (const entry of fs.readdirSync(claudeDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const skillFile = path.join(claudeDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile) || isSkippableSkillFile(skillFile)) continue;
        const content = tryReadFile(skillFile) || '';
        const fm = parseFrontmatter(content);
        // Имя из frontmatter канонично, но только если оно похоже на имя скила:
        // битый YAML вида `name: [не yaml` дал бы путь, который агент не прочитает
        const rawName = (fm.name ?? '').trim();
        const name = /^[a-zA-Z0-9._-]+$/.test(rawName) ? rawName : entry.name;
        const description = fm.description || stripFrontmatter(content).slice(0, 80).trim();
        addSkill(name, description, `.claude/skills/${entry.name}/SKILL.md`);
      }
    }
  } catch {
    /* нет каталога — нормально */
  }

  // Порядок в каталоге должен быть одинаковым на всех ОС: readdir не сортирует,
  // а обрезка лимитом отбрасывает хвост — иначе в промпт попадали бы разные скилы
  return catalog.sort((a, b) => a.name.localeCompare(b.name));
}

/** Тело скила без frontmatter — для описания, когда `description` не задан. */
function stripFrontmatter(content: string): string {
  const closed = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (closed) return content.slice(closed[0].length).trim();
  // Незакрытый блок: убираем строки «ключ: значение» в начале, иначе в описание
  // попадёт «--- name: …» и агент увидит мусор вместо назначения скила
  if (content.startsWith('---')) {
    const lines = content.split('\n').slice(1);
    let i = 0;
    while (i < lines.length && /^[\w-]+:/.test(lines[i].trim())) i += 1;
    return lines.slice(i).join('\n').trim();
  }
  return content.trim();
}

/** true, если файл нужно пропустить: симлинк или больше лимита. */
function isSkippableSkillFile(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return true;
    return stat.size > MAX_SKILL_FILE_BYTES;
  } catch {
    return true;
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

    const root = workspaceFolder.uri.fsPath;
    const agentsDir = path.join(root, '.llma', 'agents');
    const chained: AgentRole[] = [];

    if (fs.existsSync(agentsDir)) {
      const chainedFiles = fs.readdirSync(agentsDir)
        .filter(f => f.endsWith('.md') && /^\d{2}-/.test(f))
        .sort();
      for (const fileName of chainedFiles) {
        const roleName = fileName.replace(/\.md$/, '');
        const systemPrompt = tryReadFile(path.join(agentsDir, fileName)) || `Ты — ${roleName}. Отвечай кратко, по-русски.`;
        chained.push({ name: roleName, systemPrompt });
      }
    }

    // Роли из .claude/agents добавляем после цепочки .llma: проекты под Claude Code
    // получают свою оркестрацию, даже если .llma/agents вообще нет
    const claudeRoles = loadClaudeAgentRoles(root)
      .filter((role) => !chained.some((own) => own.name === role.name));

    const result = [...chained, ...claudeRoles];
    return result.length > 0 ? result : getFallbackRoles();
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

    const root = workspaceFolder.uri.fsPath;
    const agentsDir = path.join(root, '.llma', 'agents');
    const own: AgentRole[] = [];

    if (fs.existsSync(agentsDir)) {
      for (const fileName of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
        const roleName = fileName.replace(/\.md$/, '');
        const systemPrompt = tryReadFile(path.join(agentsDir, fileName)) || `Ты — ${roleName}. Отвечай кратко, по-русски.`;
        own.push({ name: roleName, systemPrompt });
      }
    }

    // .claude/agents — после своих ролей; одноимённые не дублируются
    const claudeRoles = loadClaudeAgentRoles(root)
      .filter((role) => !own.some((mine) => mine.name === role.name));
    return [...own, ...claudeRoles];
  } catch {
    return [];
  }
}

/**
 * Инструменты, которые роли вообще можно разрешать.
 *
 * Список фиксированный: `tools` из чужого файла роли не должен включать ничего,
 * чего у нас нет, и уж тем более «все инструменты MCP» по имени.
 */
export const ASSIGNABLE_TOOLS = [
  'read_file',
  'write_file',
  'replace_in_file',
  'list_files',
  'search_files',
  'run_terminal',
  'delegate_to_agent',
  'web_fetch',
  'ask_user',
] as const;

/** Разобрать `tools:` из frontmatter: `[a, b]`, `a, b` или `a b`. */
export function parseToolsField(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '');
  const names = cleaned
    .split(/[,\s]+/)
    .map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const allowed = new Set<string>(ASSIGNABLE_TOOLS);
  const valid = names.filter((name) => allowed.has(name));
  // Незнакомые имена отбрасываем: роль не должна получать инструмент, которого нет
  return valid.length > 0 ? [...new Set(valid)] : undefined;
}

/**
 * Роли из `.claude/agents/*.md` (формат Claude Code: frontmatter + тело).
 * Приоритет у `.llma/agents` — при совпадении имени роль из `.claude` не берётся.
 */
export function loadClaudeAgentRoles(workspacePath: string): AgentRole[] {
  const roles: AgentRole[] = [];
  try {
    const agentsDir = path.join(workspacePath, '.claude', 'agents');
    if (!fs.existsSync(agentsDir)) return [];

    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.isSymbolicLink()) continue;
      const filePath = path.join(agentsDir, entry.name);
      if (isSkippableSkillFile(filePath)) continue;

      const content = tryReadFile(filePath) || '';
      if (!content.trim()) continue;
      const fm = parseFrontmatter(content);
      const rawName = (fm.name ?? '').trim();
      const fallback = entry.name.replace(/\.md$/, '');
      const name = /^[a-zA-Z0-9._-]+$/.test(rawName) ? rawName : fallback;
      const body = stripFrontmatter(content);
      const description = (fm.description ?? '').trim();
      const systemPrompt = description && !body.startsWith(description)
        ? `${description}\n\n${body}`.trim()
        : (body || description);
      if (!systemPrompt) continue;

      const allowedTools = parseToolsField(fm.tools);
      roles.push({
        name,
        systemPrompt,
        ...(allowedTools ? { allowedTools } : {}),
      });
    }
  } catch {
    return [];
  }
  return roles.sort((a, b) => a.name.localeCompare(b.name));
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

/**
 * Загрузить скил по имени: сначала `.llma/skills/<имя>.md`, затем
 * `.claude/skills/<имя>/SKILL.md`. Возвращает содержимое файла (с frontmatter).
 */
export function loadSkillMd(skillName: string): string | null {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return null;
  const root = workspaceFolder.uri.fsPath;

  // Имя приходит из команды `/skill <имя>` — только безопасные символы,
  // иначе `../` уводит чтение за пределы рабочего пространства
  if (!/^[a-zA-Z0-9._-]+$/.test(skillName) || skillName.startsWith('.')) return null;

  // Сначала ищем по каталогу: имя может не совпадать с именем файла/каталога
  const fromCatalog = getSkillCatalog(root).find((s) => s.name === skillName);
  const candidates = fromCatalog
    ? [path.join(root, fromCatalog.path)]
    : [
        path.join(root, '.llma', 'skills', `${skillName}.md`),
        path.join(root, '.claude', 'skills', skillName, 'SKILL.md'),
      ];

  for (const candidate of candidates) {
    if (isSkippableSkillFile(candidate)) continue;
    const content = tryReadFile(candidate);
    if (content) return content;
  }
  return null;
}

export function invalidateRoleCache(): void { roleCache.clear(); }
