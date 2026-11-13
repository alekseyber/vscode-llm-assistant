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
  // Порядок важен: сначала узкие семейства, потом общие. Неизвестное окно честнее неверного.
  [/gpt-4\.1/i, 1_047_576],
  [/gpt-4o-mini/i, 128_000],
  [/gpt-4o/i, 128_000],
  [/gpt-4-turbo/i, 128_000],
  [/gpt-3\.5/i, 16_385],
  [/^o1-mini/i, 128_000],
  [/^(o1|o3|o4)(?!-mini)/i, 200_000],
  [/claude-3|claude-4|claude-sonnet|claude-opus|claude-haiku/i, 200_000],
  [/gemini/i, 1_048_576],
  [/deepseek-(reasoner|chat|v[234])/i, 65_536],
  [/llama-3\.[1-9]/i, 131_072],
  [/llama-?3/i, 8_192],
  [/gemma-?3/i, 131_072],
  [/gemma/i, 8_192],
  [/mistral-large/i, 131_072],
  [/mixtral/i, 32_768],
  [/mistral/i, 32_768],
  [/qwen/i, 32_768],
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

  // Никогда не превышаем окно модели: минимум 1024 ограничен сверху самим окном
  const usable = Math.min(window, Math.max(1024, window - reserveForAnswer(window)));
  const windowSource = fromProvider ? 'provider' : 'known';
  if (configured > 0 && configured < usable) {
    // Потолок реально сузил бюджет — так и говорим, иначе индикатор врёт об источнике
    return { tokens: configured, source: 'setting', window };
  }
  return { tokens: usable, source: windowSource, window };
}
