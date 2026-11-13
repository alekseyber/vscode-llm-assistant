/**
 * Эффективное окно контекста: сколько истории реально можно отправить модели.
 *
 * Зачем: `chat.maxContextTokens` был фиксированным (4096 по умолчанию), и на модели с окном
 * 32k–128k история резалась в разы сильнее, чем позволяет модель, — пользователю предлагалось
 * вручную поднимать настройку. Правило: если окно модели известно, берём его минус резерв под
 * ответ; явная настройка может сузить окно, но не расширить за пределы модели.
 */

/** Резерв под ответ: не отдаём весь контекст под историю. */
export function reserveForAnswer(windowTokens: number): number {
  return Math.min(4096, Math.max(512, Math.floor(windowTokens * 0.15)));
}

/** Известные окна по семействам моделей: имя модели → токены. */
const KNOWN: Array<[RegExp, number]> = [
  [/gpt-4\.1/i, 1_047_576],
  [/gpt-4o/i, 128_000],
  [/^(o1|o3|o4)/i, 200_000],
  [/gpt-4-turbo/i, 128_000],
  [/gpt-3\.5/i, 16_385],
  [/claude/i, 200_000],
  [/gemini/i, 1_048_576],
  [/deepseek-reasoner|deepseek-v[34]|deepseek-chat/i, 65_536],
  [/qwen/i, 32_768],
  [/llama-?3/i, 8_192],
  [/mistral|mixtral/i, 32_768],
  [/gemma/i, 8_192],
];

/** Окно по имени модели, если семейство известно. */
export function knownContextWindow(model: string | undefined): number | undefined {
  if (!model) return undefined;
  for (const [pattern, tokens] of KNOWN) {
    if (pattern.test(model)) return tokens;
  }
  return undefined;
}

export interface ResolutionInput {
  model?: string;
  /** Окно, которое сообщил провайдер (Ollama numCtx, каталог моделей) */
  providerWindow?: number;
  /**
   * `chat.maxContextTokens`: `0` — автоматически по окну модели (поведение по умолчанию).
   * Положительное значение — жёсткий потолок, который может сузить, но не расширить окно.
   */
  configured?: number;
  /** Что брать, когда окно неизвестно и потолок не задан */
  fallback?: number;
}

export interface Resolution {
  tokens: number;
  source: 'provider' | 'known' | 'setting' | 'fallback';
  window?: number;
}

/** Итоговое число токенов под историю и причина, откуда оно взялось. */
export function resolveContextTokens(input: ResolutionInput): Resolution {
  const fallback = input.fallback ?? 4096;
  const fromProvider = Number.isFinite(input.providerWindow) && (input.providerWindow ?? 0) > 0 ? input.providerWindow : undefined;
  const known = knownContextWindow(input.model);
  const window = fromProvider ?? known;

  const configured = Number.isFinite(input.configured) && (input.configured ?? 0) > 0 ? Math.floor(input.configured as number) : 0;

  if (!window) {
    return configured > 0 ? { tokens: configured, source: 'setting' } : { tokens: fallback, source: 'fallback' };
  }

  const usable = Math.max(1024, window - reserveForAnswer(window));
  // Потолок может сузить окно, но не расширить за пределы модели
  const tokens = configured > 0 ? Math.min(configured, usable) : usable;
  return { tokens, source: fromProvider ? 'provider' : 'known', window };
}
