// OllamaProvider — локальные модели через НАТИВНЫЙ API Ollama (/api/chat).
//
// Почему не OpenAI-совместимый /v1: у Ollama через /v1 рассуждение не отключается
// ни `think:false` в теле, ни `chat_template_kwargs.enable_thinking:false` — thinking-модель
// (например qwen3:8b) отдаёт пустой `content`, весь бюджет уходит в reasoning.
// Нативный /api/chat принимает `think` и отдаёт `thinking` отдельным полем — единственный
// рабочий путь (замерено 2026-10-18: 5,0 с против 27,3 с, content непустой).

import * as vscode from 'vscode';
import { BaseProvider } from './base';
import { ChatMessage, CompletionOptions, RetryCallback } from './types';
import { withRetry, DEFAULT_RETRY_OPTIONS } from '../shared/RetryHandler';
import { debugLog } from '../shared/logger';

/** Значения по умолчанию для локального провайдера. */
const DEFAULT_NUM_CTX = 8192;
const DEFAULT_LOCAL_TIMEOUT_MS = 300_000;
/** Доля бюджета ответа, после которой предупреждаем о «съеденном» рассуждении. */
const MIN_CONTENT_CHARS = 1;
/** Сколько живёт кэш списка моделей (мс). */
const MODELS_CACHE_TTL_MS = 30_000;

/** Возможности модели по данным /api/show. */
export interface OllamaCapabilities {
  tools: boolean;
  thinking: boolean;
  vision: boolean;
}

/** Настройки локального провайдера, читаемые из llmAssistant.local.* */
export interface OllamaLocalSettings {
  /** Гасить рассуждение (`think` в теле запроса); false по умолчанию */
  think: boolean;
  /** Окно контекста модели (num_ctx) */
  numCtx: number;
  /** Таймаут одного шага потока, мс */
  requestTimeoutMs: number;
  /** Включены ли ретраи (общая настройка llmAssistant.retry.enabled) */
  retryEnabled: boolean;
  /** Сколько ретраев делать дополнительно */
  maxRetries: number;
}

/**
 * Прочитать настройки локального провайдера.
 * Читается при каждом запросе — изменение применяется без перезагрузки окна.
 */
export function readOllamaLocalSettings(): OllamaLocalSettings {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  return {
    think: config.get<boolean>('local.think', false),
    numCtx: config.get<number>('local.numCtx', DEFAULT_NUM_CTX),
    requestTimeoutMs: config.get<number>('local.requestTimeout', DEFAULT_LOCAL_TIMEOUT_MS / 1000) * 1000,
    retryEnabled: config.get<boolean>('retry.enabled', true),
    maxRetries: config.get<number>('retry.maxRetries', DEFAULT_RETRY_OPTIONS.maxRetries),
  };
}

/** Ошибка провайдера с HTTP-статусом (нужна RetryHandler для классификации). */
class OllamaHttpError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OllamaHttpError';
    this.status = status;
  }
}

/** Ошибка соединения (ECONNREFUSED и родственники) — retryable по code. */
function toConnectionError(error: any): any {
  const message = error?.cause?.message || error?.message || 'Ошибка соединения с Ollama';
  // undici кладёт код в cause; для «запрещённых» портов кода нет — тогда достаём из текста
  const code =
    error?.cause?.code ||
    error?.code ||
    (typeof message === 'string' ? (message.match(/\b(E[A-Z]{3,})\b/)?.[1] ?? 'NETWORK_ERROR') : 'NETWORK_ERROR');
  const err: any = new Error(
    `Не удалось подключиться к Ollama (${code}): ${message}. ` +
      'Проверьте, что сервер запущен, baseUrl верный, а для удалённой машины открыт SSH-туннель.',
  );
  err.code = code;
  return err;
}

/** Собрать AbortSignal: пользовательская отмена + таймаут с возможностью продления. */
function createTimeoutSignal(userSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
  };
  const onUserAbort = () => controller.abort();
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
  };

  if (userSignal) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener('abort', onUserAbort, { once: true });
  }
  reset();

  return { signal: controller.signal, reset, cleanup };
}

/** Разбор одной строки NDJSON — пустые строки и мусор пропускаем. */
function parseLine(line: string): any | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    debugLog(`[ollama] пропущена нечитаемая строка NDJSON: ${trimmed.slice(0, 80)}`);
    return undefined;
  }
}

/**
 * Провайдер локальных моделей Ollama (нативный API).
 *
 * Реализует LLMProvider через BaseProvider. Не использует OpenAI SDK: у нативного
 * протокола другой формат тела и NDJSON-поток вместо SSE.
 */
export class OllamaProvider extends BaseProvider {
  /** Признак локального провайдера — по нему AgentWorker/ChatViewProvider меняют поведение. */
  public readonly isLocal = true;
  public readonly supportsVision: boolean;
  /** Кэш discovery: список моделей и время заполнения. */
  private modelsCache?: { at: number; models: string[] };
  /** Кэш capabilities по модели (на время жизни провайдера). */
  private readonly capsCache = new Map<string, OllamaCapabilities>();

  constructor(config: {
    name: string;
    baseUrl: string;
    models: string[];
    apiKey?: string;
    supportsVision?: boolean;
  }) {
    super({ name: config.name, baseUrl: config.baseUrl, apiKey: config.apiKey ?? '', models: config.models });
    this.supportsVision = config.supportsVision ?? false;
  }

  /**
   * Тело запроса к /api/chat.
   * `extraBody` намеренно не поддерживается: нативный API не принимает произвольные поля,
   * а `thinking:{type:'disabled'}` здесь бесполезен — рассуждение гасится флагом `think`.
   */
  private buildBody(
    model: string,
    messages: ChatMessage[] | any[],
    options: CompletionOptions,
    stream: boolean,
    tools?: any[],
  ): Record<string, any> {
    const local = readOllamaLocalSettings();
    const body: Record<string, any> = {
      model,
      messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      stream,
      think: local.think,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
        num_ctx: local.numCtx,
      },
    };
    if (tools && tools.length > 0) body.tools = tools;
    return body;
  }

  /** POST к нативному API с маппингом ошибок в терминах RetryHandler. */
  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: any) {
      if (signal.aborted) throw error;
      throw toConnectionError(error);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 404) {
        throw new OllamaHttpError(
          `Модель не найдена на сервере Ollama (404). Скачайте её: ollama pull ${(body as any)?.model ?? '<model>'}`,
          404,
        );
      }
      throw new OllamaHttpError(`Ollama ответила ${response.status}: ${text.slice(0, 200)}`, response.status);
    }
    return response;
  }

  /** Построчное чтение NDJSON-потока с продлением таймаута на каждый чанк. */
  private async *readNdjson(response: Response, reset: () => void): AsyncIterable<any> {
    const body = (response as any).body;
    if (!body || typeof body.getReader !== 'function') {
      // Среда без web-stream в Response (не должно случаться в Node 18+, но не падаем)
      const text = await response.text();
      for (const line of text.split('\n')) {
        const parsed = parseLine(line);
        if (parsed) yield parsed;
      }
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reset();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseLine(line);
          if (parsed) yield parsed;
        }
      }
      const tail = parseLine(buffer);
      if (tail) yield tail;
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* поток уже закрыт */
      }
    }
  }

  /** Расшифровка пустого content при непустом thinking — самая частая ловушка локальных моделей. */
  private emptyContentError(thinkingChars: number): Error {
    return new Error(
      `Модель ушла в рассуждение: content пуст, ${thinkingChars} симв. ушло в thinking. ` +
        'Увеличьте лимит ответа (maxTokens/num_predict) или убедитесь, что llmAssistant.local.think = false.',
    );
  }

  /**
   * Стриминговый чат. Отдаёт только `content`; thinking не попадает в ответ.
   * Ретраится лишь установление соединения (как в OpenAIProvider).
   */
  async *chat(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): AsyncIterable<string> {
    const local = readOllamaLocalSettings();
    const { signal: composed, reset, cleanup } = createTimeoutSignal(signal, local.requestTimeoutMs);
    if (options.extraBody) {
      debugLog('[ollama] extraBody игнорируется: нативный API не принимает произвольные поля');
    }

    try {
      const body = this.buildBody(options.model, messages, options, true);
      const response = local.retryEnabled
        ? await withRetry(() => this.post('/api/chat', body, composed), {
            signal: composed,
            onRetry,
            maxRetries: local.maxRetries,
            requestTimeoutMs: local.requestTimeoutMs,
          })
        : await this.post('/api/chat', body, composed);

      let contentChars = 0;
      let thinkingChars = 0;

      for await (const chunk of this.readNdjson(response, reset)) {
        if (signal?.aborted) break;
        const content: string = chunk?.message?.content ?? '';
        if (chunk?.message?.thinking) thinkingChars += String(chunk.message.thinking).length;
        if (content) {
          contentChars += content.length;
          yield content;
        }
        if (chunk?.done) break;
      }

      if (contentChars < MIN_CONTENT_CHARS && thinkingChars > 0) {
        throw this.emptyContentError(thinkingChars);
      }
    } finally {
      cleanup();
    }
  }

  /** Нестриминговый ответ (summary, классификация). */
  async chatComplete(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): Promise<string> {
    const local = readOllamaLocalSettings();
    const { signal: composed, cleanup } = createTimeoutSignal(signal, local.requestTimeoutMs);

    try {
      const body = this.buildBody(options.model, messages, options, false);
      const response = local.retryEnabled
        ? await withRetry(() => this.post('/api/chat', body, composed), {
            signal: composed,
            onRetry,
            maxRetries: local.maxRetries,
            requestTimeoutMs: local.requestTimeoutMs,
          })
        : await this.post('/api/chat', body, composed);

      const json: any = await response.json();
      const content: string = json?.message?.content ?? '';
      const thinking: string = json?.message?.thinking ?? '';
      if (!content && thinking) {
        throw this.emptyContentError(thinking.length);
      }
      return content;
    } finally {
      cleanup();
    }
  }

  /**
   * Список моделей: `GET /api/tags` с кэшем 30 с.
   * При недоступном сервере (или ошибке) — список из конфигурации, без исключения:
   * селектор моделей не должен ломаться из-за выключенного Ollama.
   */
  async models(): Promise<string[]> {
    const now = Date.now();
    if (this.modelsCache && now - this.modelsCache.at < MODELS_CACHE_TTL_MS) {
      return [...this.modelsCache.models];
    }

    const configured = await super.models();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) {
        debugLog(`[ollama] /api/tags ответил ${response.status} — берём модели из конфига`);
        return configured;
      }
      const json: any = await response.json();
      const discovered: string[] = (json?.models ?? [])
        .map((m: any) => m?.name ?? m?.model)
        .filter((name: any): name is string => typeof name === 'string' && name.length > 0);

      // Модели из конфига идут первыми (порядок пользователя), затем новые из discovery
      const merged = [...configured, ...discovered.filter((name) => !configured.includes(name))];
      if (merged.length === 0) return configured;

      this.modelsCache = { at: now, models: merged };
      debugLog(`[ollama] discovery: ${merged.length} моделей (${discovered.length} с сервера)`);
      return [...merged];
    } catch (error: any) {
      debugLog(`[ollama] discovery недоступен: ${error?.message ?? error}`);
      return configured;
    }
  }

  /** Сбросить кэш discovery (команда проверки сервера, смена настроек). */
  invalidateCache(): void {
    this.modelsCache = undefined;
    this.capsCache.clear();
  }

  /** Версия сервера — `GET /api/version` (для команды проверки). */
  async version(): Promise<string | undefined> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, { method: 'GET' });
      if (!response.ok) return undefined;
      const json: any = await response.json();
      return typeof json?.version === 'string' ? json.version : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Возможности модели по `/api/show` (tools / thinking / vision).
   * Вызывается только по явному действию (команда проверки сервера), кэшируется на сессию.
   */
  async capabilities(model: string): Promise<OllamaCapabilities | undefined> {
    const cached = this.capsCache.get(model);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!response.ok) return undefined;
      const json: any = await response.json();
      const caps: string[] = Array.isArray(json?.capabilities) ? json.capabilities : [];
      const result: OllamaCapabilities = {
        tools: caps.includes('tools'),
        thinking: caps.includes('thinking'),
        vision: caps.includes('vision'),
      };
      this.capsCache.set(model, result);
      return result;
    } catch {
      return undefined;
    }
  }

  /** Размеры моделей с сервера (ГБ) — для человекочитаемого отчёта команды проверки. */
  async modelSizes(): Promise<Record<string, number>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) return {};
      const json: any = await response.json();
      const sizes: Record<string, number> = {};
      for (const m of json?.models ?? []) {
        const name: string | undefined = m?.name ?? m?.model;
        if (name && typeof m?.size === 'number') sizes[name] = m.size;
      }
      return sizes;
    } catch {
      return {};
    }
  }
}

/** Форматирование размера модели в ГБ для отчёта команды проверки. */
function formatSize(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} ГБ`;
}

/**
 * Человекочитаемый отчёт о локальном сервере: версия, модели, capabilities.
 * Вынесено отдельной функцией, чтобы её можно было проверить тестом без VS Code.
 */
export async function describeLocalServer(provider: OllamaProvider): Promise<string[]> {
  const version = await provider.version();
  if (!version) {
    return [
      'Ollama недоступен.',
      'Проверьте: сервер запущен (`ollama serve`), baseUrl верный, для удалённой машины открыт SSH-туннель.',
    ];
  }

  const models = await provider.models();
  const sizes = await provider.modelSizes();
  const lines: string[] = [`Ollama ${version} · ${models.length} моделей`];

  if (models.length === 0) {
    lines.push('Моделей нет — скачайте: ollama pull qwen3:8b');
    return lines;
  }

  for (const model of models) {
    const caps = await provider.capabilities(model);
    const flags = caps
      ? [caps.tools ? 'tools' : null, caps.thinking ? 'thinking' : null, caps.vision ? 'vision' : null].filter(Boolean).join(', ') || 'completion'
      : 'capabilities не прочитаны';
    const size = sizes[model] !== undefined ? ` · ${formatSize(sizes[model])}` : '';
    lines.push(`• ${model}${size} · ${flags}`);
  }

  return lines;
}
