/**
 * Проверка манифеста скилла: frontmatter и структура.
 *
 * Зачем: скилл — это инструкция агенту, и правка `.md` молча меняет его поведение.
 * Модуль отдельный от загрузчика, чтобы проверку можно было гонять в CI и в тестах
 * на строках, не поднимая файловую систему.
 */

export interface SkillManifestResult {
  /** Имя скилла из frontmatter (каноничное) или пустая строка */
  name: string;
  /** Описание из frontmatter или пустая строка */
  description: string;
  /** Версия скилла, если указана (формат `x.y.z`) */
  version?: string;
  /** Дата обновления, если указана (формат `YYYY-MM-DD`) */
  updated?: string;
  /** Что не так: пустой список — манифест годен */
  errors: string[];
}

import { MAX_SKILL_FILE_BYTES } from './skillLimits';

/** Скилл больше этого не читаем: это не инструкция, а свалка. Общий лимит с загрузчиком. */
export const MAX_SKILL_BYTES = MAX_SKILL_FILE_BYTES;

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Разобрать frontmatter между `---`; значения — плоские строки, как в загрузчике ролей. */
export function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Проверить содержимое файла скилла.
 *
 * Обязательны `name` и `description`: без них скилл не попадает в каталог агента и
 * превращается в мёртвый файл. `version` и `updated` необязательны, но если указаны —
 * обязаны быть в ожидаемом формате: по ним сверяется порядок правок.
 */
export function validateSkillContent(content: string, filePath = 'SKILL.md'): SkillManifestResult {
  const errors: string[] = [];
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > MAX_SKILL_BYTES) {
    errors.push(`${filePath}: файл ${bytes} байт — больше лимита ${MAX_SKILL_BYTES}`);
  }

  // Поддерживаем только плоский frontmatter. Многострочные и вложенные значения
  // не разбираем: молча пропустить их значило бы врать про результат проверки.
  const raw = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (raw && /^\s*(\||>)/m.test(raw[1])) {
    errors.push(`${filePath}: многострочное значение в frontmatter не поддерживается (| или >)`);
  }
  if (raw && /^\s{2,}\S/m.test(raw[1])) {
    errors.push(`${filePath}: вложенный YAML во frontmatter не поддерживается`);
  }

  const meta = parseSkillFrontmatter(content);
  const name = (meta.name ?? '').trim();
  const description = (meta.description ?? '').trim();
  const version = (meta.version ?? '').trim();
  const updated = (meta.updated ?? '').trim();

  if (!name) errors.push(`${filePath}: нет name в frontmatter`);
  if (name && /\s/.test(name)) errors.push(`${filePath}: name содержит пробелы — имя скилла одно слово`);

  // Имя должно совпадать с файлом/каталогом: иначе загрузчик скилл не найдёт
  const base = filePath.split('/').pop() ?? '';
  const expected = base.toLowerCase() === 'skill.md'
    ? (filePath.split('/').slice(-2)[0] ?? '').toLowerCase()
    : base.replace(/\.md$/i, '').toLowerCase();
  if (name && expected && name.toLowerCase() !== expected) {
    errors.push(`${filePath}: name «${name}» не совпадает с именем файла/каталога «${expected}»`);
  }
  if (!description) errors.push(`${filePath}: нет description в frontmatter`);
  if (version && !VERSION_RE.test(version)) {
    errors.push(`${filePath}: version «${version}» — ожидается x.y.z`);
  }
  if (updated && !DATE_RE.test(updated)) {
    errors.push(`${filePath}: updated «${updated}» — ожидается YYYY-MM-DD`);
  }

  return { name, description, version: version || undefined, updated: updated || undefined, errors };
}

/** Найти дубли имён: имя сравнивается без учёта регистра и пробелов по краям. */
export function findDuplicateNames(skills: Array<{ name: string; filePath: string }>): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    if (!key) continue;
    const previous = seen.get(key);
    if (previous) {
      errors.push(`имя «${skill.name}» встречается дважды: ${previous} и ${skill.filePath}`);
      continue;
    }
    seen.set(key, skill.filePath);
  }
  return errors;
}

/**
 * Проверка «правка помечена»: если файл скилла изменился, у него обязаны измениться
 * `version` или `updated`. Иначе правка инструкции проходит незаметно — ровно тот случай,
 * ради которого гейт и заводился.
 */
export function validateChangedSkill(filePath: string, before: string, after: string): string[] {
  const previous = parseSkillFrontmatter(before);
  const current = parseSkillFrontmatter(after);
  const versionChanged = (previous.version ?? '') !== (current.version ?? '');
  const updatedChanged = (previous.updated ?? '') !== (current.updated ?? '');
  if (versionChanged || updatedChanged) return [];
  return [`${filePath}: файл изменён, но version и updated те же — отметьте правку (version или updated)`];
}
