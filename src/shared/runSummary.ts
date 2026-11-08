// Сводка по фактическим изменениям файлов за прогон агента.
//
// Зачем: модель может ответить «Готово, заменил», не вызвав ни одного инструмента
// (воспроизведено 08.11.2026 на кривом промте). Строка «Изменено файлов: 0» показывает
// это сразу, не требуя читать лог шагов.

/** Инструменты, которые реально пишут в файлы. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['write_file', 'patch_file', 'replace_in_file']);

export interface StepLike {
  type: string;
  toolName?: string;
  toolResult?: string;
  message?: string;
}

/** Похоже ли сообщение на отказ или ошибку инструмента. */
function isFailure(text: string | undefined): boolean {
  if (!text) return false;
  return /^(ошибка|отклонена|операция отклонена|error)/i.test(text.trim());
}

/**
 * Сколько успешных записей в файлы было за прогон.
 * Считаются только шаги `tool_result` с инструментом записи и без признака ошибки/отказа.
 */
export function countFileChanges(steps: readonly StepLike[] | undefined): number {
  return changedFiles(steps).length;
}

/**
 * Пути, которые реально изменились за прогон (без повторов).
 * Повторная запись того же файла — одна правка, а не две.
 * Путь берётся из результата инструмента («Файл записан: <path> …»), если он там есть.
 */
export function changedFiles(steps: readonly StepLike[] | undefined): string[] {
  if (!steps || steps.length === 0) return [];
  const files = new Set<string>();
  let unknown = 0;
  for (const s of steps) {
    if (s.type !== 'tool_result' || !s.toolName || !WRITE_TOOLS.has(s.toolName)) continue;
    if (isFailure(s.toolResult)) continue;
    // «Файл не изменён» — не правка
    if (/не изменён/i.test(s.toolResult ?? '')) continue;
    const m = /Файл записан:\s*(.+?)\s*\(/.exec(s.toolResult ?? '');
    if (m) files.add(m[1]);
    else unknown += 1;
  }
  return [...files, ...Array.from({ length: unknown }, (_, i) => `#${i}`)];
}

/**
 * Готовая строка для ответа агента: «📝 Изменено файлов: N» или «📝 Файлы не изменялись».
 */
export function fileChangesSummary(steps: readonly StepLike[] | undefined): string {
  const n = countFileChanges(steps);
  return n > 0 ? `📝 Изменено файлов: ${n}` : '📝 Файлы не изменялись';
}
