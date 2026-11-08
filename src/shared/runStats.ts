// Сводка по истории запусков (P13): сколько стоит по типам задач и где агент падает.
//
// Зачем: без агрегата настройка бюджета и маршрутизации моделей (P9) делается интуицией.
// Модуль чистый — считает по массиву RunEntry, без VS Code.

import { RunEntry } from './RunHistoryStore';

export interface GroupStats {
  /** Ключ группы: режим (`chat`/`agent`/`edit`) или имя модели */
  key: string;
  /** Сколько запусков в группе */
  count: number;
  /** Суммарная стоимость, USD */
  cost: number;
  /** Средняя стоимость запуска, USD */
  costAvg: number;
  /** Доля незавершённых успешно (error + cancelled + limit_exceeded), 0..1 */
  failRate: number;
  /** Средняя длительность, мс */
  durationAvg: number;
}

export interface RunStats {
  total: number;
  costTotal: number;
  costAvg: number;
  /** Сколько запусков завершились успешно */
  success: number;
  errors: number;
  cancelled: number;
  limitExceeded: number;
  /** Доля ошибок (только status=error), 0..1 */
  errorRate: number;
  byMode: GroupStats[];
  byModel: GroupStats[];
}

const FAIL_STATUSES = new Set(['error', 'cancelled', 'limit_exceeded']);

/** Отфильтровать запуски по периоду: `sinceMs` — нижняя граница timestamp. */
export function filterRuns(runs: readonly RunEntry[], sinceMs?: number): RunEntry[] {
  if (!sinceMs) return [...runs];
  return runs.filter((r) => r.timestamp >= sinceMs);
}

function group(runs: readonly RunEntry[], keyOf: (r: RunEntry) => string): GroupStats[] {
  const buckets = new Map<string, RunEntry[]>();
  for (const r of runs) {
    const key = keyOf(r) || '—';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }
  return [...buckets.entries()]
    .map(([key, items]) => {
      const count = items.length;
      const cost = items.reduce((s, r) => s + (r.cost || 0), 0);
      const fails = items.filter((r) => FAIL_STATUSES.has(r.status)).length;
      const duration = items.reduce((s, r) => s + (r.duration || 0), 0);
      return {
        key,
        count,
        cost,
        costAvg: count > 0 ? cost / count : 0,
        failRate: count > 0 ? fails / count : 0,
        durationAvg: count > 0 ? duration / count : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost || b.count - a.count);
}

/**
 * Посчитать сводку по запускам.
 * @param runs записи истории (любой порядок)
 * @param sinceMs если задано — учитываются только запуски не старше этой метки
 */
export function computeRunStats(runs: readonly RunEntry[], sinceMs?: number): RunStats {
  const items = filterRuns(runs, sinceMs);
  const total = items.length;
  const costTotal = items.reduce((s, r) => s + (r.cost || 0), 0);
  const errors = items.filter((r) => r.status === 'error').length;
  const cancelled = items.filter((r) => r.status === 'cancelled').length;
  const limitExceeded = items.filter((r) => r.status === 'limit_exceeded').length;
  const success = items.filter((r) => r.status === 'success').length;

  return {
    total,
    costTotal,
    costAvg: total > 0 ? costTotal / total : 0,
    success,
    errors,
    cancelled,
    limitExceeded,
    errorRate: total > 0 ? errors / total : 0,
    byMode: group(items, (r) => r.mode),
    byModel: group(items, (r) => r.model),
  };
}

/** Готовая строка-сводка для вкладки «История». */
export function formatStatsLine(stats: RunStats): string {
  if (stats.total === 0) return 'Запусков нет';
  const pct = Math.round(stats.errorRate * 100);
  return `${stats.total} запусков · $${stats.costTotal.toFixed(4)} всего · $${stats.costAvg.toFixed(4)} в среднем · ошибок ${pct}%`;
}
