/**
 * Дневной счётчик расхода: слияние записанного значения с локальным кэшем окна.
 *
 * Зачем отдельная функция: `Memento` даёт только read-modify-write, поэтому окно,
 * держащее кэш, затирало расход, сделанный другим окном VS Code. Правила:
 *  - деньги считаем целыми микро-долларами (float накапливает ошибку: `1.1 + 0.1 ≠ 1.2`);
 *  - `rev` растёт при каждой записи; если в `globalState` ревизия новее кэша, источник —
 *    записанное (иначе ручной сброс счётчика отменялся бы старым кэшем другого окна);
 *  - при равных ревизиях берём максимум: записанное забирает чужие траты, кэш страхует
 *    от асинхронной записи, которая ещё не долетела.
 *
 * Остаточный риск: одновременная запись из двух окон (миллисекундное окно) всё ещё может
 * потерять одну порцию. Надёжный источник истины — счёт у провайдера, счётчик лишь охраняет лимит.
 */

export const MICRO = 1_000_000;

export interface DailySpendState {
  date: string;
  /** Расход в микро-долларах: целое, чтобы не накапливать ошибку double */
  usdMicro: number;
  /** Ревизия записи: сброс и любое изменение увеличивают её */
  rev: number;
}

/** Перевести доллары в микро-доллары (округление к ближайшему). */
export function toMicro(usd: number): number {
  if (!Number.isFinite(usd)) return 0;
  return Math.round(usd * MICRO);
}

/** Перевести микро-доллары в доллары для показа и проверок лимита. */
export function fromMicro(usdMicro: number): number {
  return Number.isFinite(usdMicro) ? usdMicro / MICRO : 0;
}

/** Следующее состояние счётчика: `база + расход`, база — по правилу ревизий. */
export function mergeDailySpend(
  stored: DailySpendState | undefined,
  cached: DailySpendState | undefined,
  usdMicro: number,
  date: string,
): DailySpendState {
  const valid = (s: DailySpendState | undefined): s is DailySpendState =>
    !!s && s.date === date && Number.isFinite(s.usdMicro) && Number.isFinite(s.rev);

  const increment = Number.isFinite(usdMicro) && usdMicro > 0 ? Math.round(usdMicro) : 0;

  if (!valid(stored)) {
    const base = valid(cached) ? cached.usdMicro : 0;
    return { date, usdMicro: base + increment, rev: (valid(cached) ? cached.rev : 0) + 1 };
  }
  if (!valid(cached)) {
    return { date, usdMicro: stored.usdMicro + increment, rev: stored.rev + 1 };
  }
  // Записанное новее кэша — доверяем ему (здесь живёт ручной сброс и расход другого окна)
  if (stored.rev > cached.rev) {
    return { date, usdMicro: stored.usdMicro + increment, rev: stored.rev + 1 };
  }
  return { date, usdMicro: Math.max(stored.usdMicro, cached.usdMicro) + increment, rev: Math.max(stored.rev, cached.rev) + 1 };
}
