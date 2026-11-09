// Тесты детектора обрезки промпта (P18): чистая функция, без сервера и VS Code.
// AC: OLL-9.1, OLL-9.2 (границы), CG-1..CG-3

import 'mocha';
import * as assert from 'assert';
import { buildTruncationWarning, effectivePromptWindow } from '../../src/providers/ollama';

suite('Обрезка промпта (buildTruncationWarning)', () => {
  const numCtx = 4096;

  test('CG-1: граница включительно — окно промпта (numCtx/2) минус 16 предупреждает, минус 17 нет', () => {
    const window = effectivePromptWindow(numCtx);
    const atBoundary = buildTruncationWarning({ model: 'qwen3:8b', promptTokens: window - 16, numCtx });
    assert.ok(atBoundary, 'на границе окна-16 предупреждение должно быть');

    const belowBoundary = buildTruncationWarning({ model: 'qwen3:8b', promptTokens: window - 17, numCtx });
    assert.strictEqual(belowBoundary, null, 'на окно-17 предупреждения быть не должно');

    assert.ok(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: window, numCtx }), 'ровно окно');
    assert.ok(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: window + 100, numCtx }), 'выше окна');
    assert.strictEqual(
      buildTruncationWarning({ model: 'qwen3:8b', promptTokens: window - 200, numCtx }),
      null,
      'заметно ниже окна — тишина',
    );
  });

  test('CG-4: замеры живого сервера — обрезанный промпт всегда попадает в предупреждение', () => {
    // num_ctx → prompt_eval_count на Ollama 0.40.15 (NUM_PARALLEL=1, CONTEXT_LENGTH=16384)
    const measurements: Array<[number, number]> = [
      [512, 258], [1024, 514], [4096, 2050], [8192, 4098], [16384, 8194],
    ];
    for (const [ctx, count] of measurements) {
      assert.ok(
        buildTruncationWarning({ model: 'qwen3:8b', promptTokens: count, numCtx: ctx }),
        `num_ctx=${ctx}: ${count} токенов — это обрезка, предупреждение обязательно`,
      );
    }
    // Промпт доехал целиком: 7k символов ≈ 2,6k токенов при окне 16384
    assert.strictEqual(
      buildTruncationWarning({ model: 'qwen3:8b', promptTokens: 2611, numCtx: 16384 }),
      null,
      'полностью обработанный промпт молчит',
    );
  });

  test('CG-2: нет данных о токенах — null (0, undefined, NaN)', () => {
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: 0, numCtx }), null);
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: undefined, numCtx }), null);
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: null, numCtx }), null);
    assert.strictEqual(buildTruncationWarning({ model: 'qwen3:8b', promptTokens: NaN, numCtx }), null);
  });

  test('CG-3: текст называет оба числа и обе ручки настройки', () => {
    const text = buildTruncationWarning({ model: 'qwen3:8b', promptTokens: 2050, numCtx });
    assert.ok(text);
    assert.match(text, /2050/, 'число обработанных токенов');
    assert.match(text, /4096/, 'лимит окна');
    assert.match(text, /2048/, 'эффективное окно промпта');
    assert.match(text, /llmAssistant\.local\.numCtx/);
    assert.match(text, /OLLAMA_CONTEXT_LENGTH/);
    assert.match(text, /вероятно, обрезан/);
  });
});
