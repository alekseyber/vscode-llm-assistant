// SearchRouter — решает, каким путём искать, и склеивает выдачу (P8, этап S3).
//
// Модель не выбирает «точный или смысловой поиск»: инструмент один, роутинг в коде
// (рамка P8). Контракт `search_files` не меняется — меняется качество выдачи.

/** Куда уходит запрос: точный поиск (ripgrep-путь) или лексический индекс (FTS). */
export type SearchBackend = 'exact' | 'fuzzy';

export interface IndexedHit {
  path: string;
  rank: number;
  snippet?: string;
}

export interface MergedHit {
  path: string;
  snippet: string;
  source: 'exact' | 'fuzzy';
}

/** С какого числа результатов лексическая выдача считается достаточной. */
export const MIN_FUZZY_HITS = 3;

/**
 * Запрос похож на идентификатор или содержит regex-спецсимволы → точный поиск.
 *
 * Точный путь сильнее там, где пользователь знает, что ищет: `calculateCost`,
 * `PROMPT_EVAL_COUNT`, `foo(`, `^export`, `path/to/file`. Лексический индекс на таких
 * запросах выдаёт шум: стеммер и разбиение по регистру превращают идентификатор в набор слов.
 */
export function classifyQuery(query: string): SearchBackend {
  const text = (query ?? '').trim();
  if (!text) return 'exact';

  // Явные regex-конструкции
  if (/[\\^$.*+?()[\]{}|]/.test(text)) return 'exact';

  // Идентификаторы: camelCase, snake_case, точки/слэши в пути, дефисы внутри слова
  if (/[a-zа-я][A-ZА-Я]/.test(text)) return 'exact';
  if (/_/.test(text)) return 'exact';
  if (/[/\\.]/.test(text) && !/\s/.test(text)) return 'exact';

  // Одно слово без пробелов — скорее имя сущности, чем фраза
  if (!/\s/.test(text)) return 'exact';

  return 'fuzzy';
}

/** Нужно ли доклеить лексическую выдачу: мало результатов или индекс дал пусто. */
export function needsMerge(fuzzyHits: readonly IndexedHit[], minHits = MIN_FUZZY_HITS): boolean {
  return fuzzyHits.length < minHits;
}

/**
 * Склейка: точные совпадения сверху, затем лексические, дубли по пути схлопываются.
 * Порядок внутри групп сохраняется — его задал соответствующий движок.
 */
export function mergeHits(
  exact: ReadonlyArray<{ path: string; snippet: string }>,
  fuzzy: readonly IndexedHit[],
): MergedHit[] {
  const seen = new Set<string>();
  const merged: MergedHit[] = [];

  for (const hit of exact) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    merged.push({ path: hit.path, snippet: hit.snippet, source: 'exact' });
  }
  // Лексическая выдача уже отсортирована по bm25 (меньше — лучше)
  for (const hit of [...fuzzy].sort((a, b) => a.rank - b.rank)) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    merged.push({ path: hit.path, snippet: hit.snippet ?? '', source: 'fuzzy' });
  }
  return merged;
}
