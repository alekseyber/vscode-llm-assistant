// Тесты для streaming.ts — SSE парсинг стриминговых ответов LLM
// Проверяет: разбор SSE data: чанков, обработку [DONE], извлечение delta.content,
// обработку ошибок парсинга, прерывание потока через AbortSignal

import 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import {
  parseSSE,
  parseChatCompletionStream,
  extractDeltaContent,
  isStreamDone,
  createMockStream,
  SSEMalformedError,
} from '../../src/shared/streaming';

suite('Streaming (SSE парсинг)', () => {
  // Читаем тестовый SSE-поток из файла
  const fixturePath = path.resolve(__dirname, '../../../test/fixtures/mock-responses/chat-stream.txt');
  let sseFixture: string;

  suiteSetup(() => {
    sseFixture = fs.readFileSync(fixturePath, 'utf-8');
  });

  test('AC-9.3: parseSSE разбирает многострочный SSE-поток', () => {
    const events = parseSSE(sseFixture);

    // Должно быть 7 событий (6 data: + 1 [DONE])
    assert.strictEqual(events.length, 7, 'Должно быть 7 SSE-событий');

    // Проверяем первое событие (роль assistant, пустой контент)
    assert.strictEqual(events[0].data, '{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}');

    // Проверяем последнее событие ([DONE])
    assert.strictEqual(events[6].data, '[DONE]', 'Последнее событие должно быть [DONE]');
  });

  test('parseSSE возвращает пустой массив для пустого ввода', () => {
    assert.deepStrictEqual(parseSSE(''), []);
    assert.deepStrictEqual(parseSSE('   '), []);
    assert.deepStrictEqual(parseSSE('\n\n\n'), []);
  });

  test('parseSSE обрабатывает event: поле', () => {
    const text = 'event: myevent\ndata: {"key":"value"}\n\n';
    const events = parseSSE(text);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event, 'myevent');
    assert.strictEqual(events[0].data, '{"key":"value"}');
  });

  test('parseSSE игнорирует комментарии', () => {
    const text = ': Это комментарий\ndata: {"key":"value"}\n\n';
    const events = parseSSE(text);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data, '{"key":"value"}');
  });

  test('parseSSE обрабатывает многострочные данные', () => {
    const text = 'data: line1\ndata: line2\n\n';
    const events = parseSSE(text);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data, 'line1\nline2');
  });

  test('isStreamDone определяет сигнал завершения [DONE]', () => {
    assert.ok(isStreamDone('[DONE]'));
    assert.ok(isStreamDone(' [DONE] '));
    assert.ok(!isStreamDone('{"key":"value"}'));
    assert.ok(!isStreamDone(''));
  });

  test('extractDeltaContent извлекает контент из чанка', () => {
    const chunk = {
      choices: [
        {
          delta: {
            content: 'Привет',
          },
        },
      ],
    };

    assert.strictEqual(extractDeltaContent(chunk), 'Привет');
  });

  test('extractDeltaContent возвращает null при отсутствии choices', () => {
    assert.strictEqual(extractDeltaContent({}), null);
  });

  test('extractDeltaContent возвращает null при пустом choices', () => {
    assert.strictEqual(extractDeltaContent({ choices: [] }), null);
  });

  test('extractDeltaContent возвращает null при отсутствии delta', () => {
    assert.strictEqual(extractDeltaContent({ choices: [{}] }), null);
  });

  test('extractDeltaContent возвращает null если content не строка', () => {
    const chunk = {
      choices: [
        {
          delta: {
            content: null,
          },
        },
      ],
    };
    assert.strictEqual(extractDeltaContent(chunk as any), null);
  });

  test('parseChatCompletionStream разбирает полный SSE-поток в токены', () => {
    const tokens = parseChatCompletionStream(sseFixture);

    // Должно быть 5 токенов (первый чанк — служебный, без content; [DONE] пропускается)
    assert.strictEqual(tokens.length, 5, 'Должно быть 5 токенов');

    // Проверяем содержимое токенов
    assert.strictEqual(tokens[0], 'Привет');
    assert.strictEqual(tokens[1], '! ');
    assert.strictEqual(tokens[2], 'Как');
    assert.strictEqual(tokens[3], ' дела');
    assert.strictEqual(tokens[4], '?');
  });

  test('parseChatCompletionStream пропускает невалидный JSON', () => {
    const text = 'data: {invalid json}\n\ndata: {"choices":[{"delta":{"content":"valid"}}]}\n\n';
    const tokens = parseChatCompletionStream(text);

    // Должен быть только валидный токен
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0], 'valid');
  });

  test('createMockStream выдаёт все чанки по порядку', async () => {
    const chunks = ['Hello', ' ', 'World', '!'];
    const stream = createMockStream(chunks);
    const result: string[] = [];

    for await (const chunk of stream) {
      result.push(chunk);
    }

    assert.deepStrictEqual(result, chunks);
  });

  test('createMockStream прерывается при aborted сигнале', async () => {
    const chunks = ['token1', 'token2', 'token3', 'token4'];
    const controller = new AbortController();
    const stream = createMockStream(chunks, controller.signal);
    const result: string[] = [];

    let count = 0;
    for await (const chunk of stream) {
      result.push(chunk);
      count++;
      if (count >= 2) {
        controller.abort(); // Прерываем после 2-го токена
      }
    }

    assert.strictEqual(result.length, 2, 'Должно быть только 2 токена после abort');
    assert.deepStrictEqual(result, ['token1', 'token2']);
  });

  test('createMockStream пустой поток', async () => {
    const stream = createMockStream([]);
    const result: string[] = [];

    for await (const chunk of stream) {
      result.push(chunk);
    }

    assert.strictEqual(result.length, 0);
  });

  test('parseSSE обрабатывает блоки с разными разделителями', () => {
    // Windows-style line endings
    const text = 'data: first\r\n\r\ndata: second\r\n\r\n';
    const events = parseSSE(text);

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].data, 'first');
    assert.strictEqual(events[1].data, 'second');
  });
});