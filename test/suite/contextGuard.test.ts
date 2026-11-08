// Тесты детектора обрезки промпта (P18): чистая функция, без сервера и VS Code.
// AC: OLL-9.1, OLL-9.2 (границы), CG-1..CG-3

import 'mocha';
import * as assert from 'assert';
import { buildTruncationWarning } from '../../src/providers/ollama';

suite('Обрезка промпта (buildTruncationWarning)', () => {
  const numCtx = 4096;

  test('CG-1: граница включительно — numCtx-16 предупреждает, numCtx-17 нет', () => {
    const atBoundary = buildTruncationWarning({ model: 'qwen3:8b', promptTokens: numCtx - 16, numCtx });
    assert.ok(atBoundary, 'на границе numCtx-16 предупреждение должно быть');

    const belowBoundary = buildTruncationWarning({ model: 'qwen3:8b', promptTokens: numCtx - 17, numCtx });
    assert.strictEqual(belowBoundary, null, 'на numCtx-17 предупреждения быть не должно');

    assert.ok(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: numCtx, numCtx }), 'ровно окно');
    assert.ok(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: numCtx + 100, numCtx }), 'выше окна');
    assert.strictEqual(
      buildTruncationWarning({ model: 'qwen3:8b', promptTokens: numCtx - 200, numCtx }),
      null,
      'заметно ниже окна — тишина',
    );
  });

  test('CG-2: нет данных о токенах — null (0, undefined, NaN)', () => {
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: 0, numCtx }), null);
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: undefined, numCtx }), null);
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: null, numCtx }), null);
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: NaN, numCtx }), null);
  });

  test('CG-3: текст называет оба числа и обе ручки настройки', () => {
    const text = buildTruncationWarning({ model: 'qwen3:8b', promptTokens: 4100, numCtx });
    assert.ok(text);
    assert.match(text, /4100/, 'число обработанных токенов');
    assert.match(text, /4096/, 'лимит окна');
    assert.match(text, /llmAssistant\.local\.numCtx/);
    assert.match(text, /OLLAMA_CONTEXT_LENGTH/);
    assert.match(text, /вероятно, обрезан/);
  });
});
