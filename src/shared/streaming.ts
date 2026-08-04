// SSE парсер для потоковых ответов LLM
// Разбирает формат Server-Sent Events: data: {json}\n\n
// Извлекает содержимое delta-чанков для chat completion потока

/**
 * Событие SSE, полученное в результате парсинга.
 */
export interface SSEEvent {
  /** Имя события (опционально, из 'event:') */
  event?: string;
  /** Данные события (содержимое после 'data:') */
  data: string;
}

/** Ошибка парсинга SSE */
export class SSEMalformedError extends Error {
  constructor(message: string) {
    super(`SSE parsing error: ${message}`);
    this.name = 'SSEMalformedError';
  }
}

/**
 * Разобрать сырой SSE-текст в массив событий.
 * Поддерживает стандартный SSE формат:
 *   data: {json}\n\n
 *   event: {name}\n data: {json}\n\n
 *   data: [DONE]\n\n — сигнал завершения
 *
 * Пропускает комментарии (строки, начинающиеся с ':').
 *
 * @param text — сырой SSE-текст (может содержать несколько событий)
 * @returns массив SSEEvent
 * @throws SSEMalformedError если данные повреждены
 */
export function parseSSE(text: string): SSEEvent[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Нормализуем переносы строк (Windows \r\n → \n) для единообразного разбора
  const normalized = text.replace(/\r\n/g, '\n');

  const events: SSEEvent[] = [];
  // Разделяем на блоки по двойным переносам строки (\n\n)
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const event = parseSSEBlock(trimmed);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Разобрать один блок SSE (набор строк, разделённых \n).
 * Блок начинается с "event:" или "data:".
 * Завершается пустой строкой (входной параметр уже без неё).
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split('\n');
  let eventName: string | undefined;
  let data: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith(':')) {
      // Комментарий — пропускаем
      continue;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      // Убираем ровно один ведущий пробел после двоеточия (по спецификации SSE)
      let payload = line.slice(5);
      if (payload.startsWith(' ')) {
        payload = payload.slice(1);
      }
      data = data !== undefined ? data + '\n' + payload : payload;
      continue;
    }

    // Неизвестное поле — игнорируем (по спецификации SSE)
  }

  if (data === undefined) {
    // Нет data: — пропускаем блок
    return null;
  }

  return { event: eventName, data };
}

/**
 * Проверить, является ли событие сигналом завершения потока.
 * OpenAI использует "data: [DONE]" как маркер конца стрима.
 */
export function isStreamDone(data: string): boolean {
  return data.trim() === '[DONE]';
}

/**
 * Извлечь содержимое delta.content из чанка chat completion stream.
 * Формат: {"choices":[{"delta":{"content":"текст"}}]}
 *
 * @param chunk — разобранный JSON-объект чанка
 * @returns строка контента, или null если контента нет
 */
export function extractDeltaContent(chunk: Record<string, unknown>): string | null {
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return null;

  const delta = choices[0]?.delta as Record<string, unknown> | undefined;
  if (!delta) return null;

  const content = delta.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Полный парсинг SSE-потока chat completion.
 * Принимает сырой SSE-текст, разбирает его в события,
 * отфильтровывает [DONE] и возвращает только содержимое delta.content.
 *
 * @param text — сырой SSE-текст от chat completion stream
 * @returns массив строк (токенов) из чанков ответа
 */
export function parseChatCompletionStream(text: string): string[] {
  const events = parseSSE(text);
  const tokens: string[] = [];

  for (const event of events) {
    if (isStreamDone(event.data)) {
      continue;
    }

    try {
      const json = JSON.parse(event.data);
      const content = extractDeltaContent(json);
      // Пропускаем пустые строки (служебные чанки с role, но без content)
      if (content !== null && content !== '') {
        tokens.push(content);
      }
    } catch {
      // Пропускаем некорректные JSON (крайне редкий случай,
      // но некоторые прокси могут добавлять невалидные строки)
      continue;
    }
  }

  return tokens;
}

/**
 * Создать AsyncIterable<string> для тестирования.
 * Позволяет имитировать SSE-поток с возможностью прерывания.
 *
 * @param chunks — заранее заданные строки-чанки (токены)
 * @param signal — опциональный AbortSignal для проверки прерывания
 * @returns AsyncIterable<string>
 */
export async function* createMockStream(
  chunks: string[],
  signal?: AbortSignal
): AsyncIterable<string> {
  for (const chunk of chunks) {
    if (signal?.aborted) {
      break;
    }
    yield chunk;
  }
}