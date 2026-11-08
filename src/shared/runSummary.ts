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
  if (!steps || steps.length === 0) return 0;
  return steps.filter(
    (s) => s.type === 'tool_result'
      && !!s.toolName
      && WRITE_TOOLS.has(s.toolName)
      && !isFailure(s.toolResult),
  ).length;
}

/**
 * Готовая строка для ответа агента: «📝 Изменено файлов: N» или «📝 Файлы не изменялись».
 */
export function fileChangesSummary(steps: readonly StepLike[] | undefined): string {
  const n = countFileChanges(steps);
  return n > 0 ? `📝 Изменено файлов: ${n}` : '📝 Файлы не изменялись';
}
