// Эффективное окно контекста: сколько истории можно отправить модели.
//
// Мотив: `chat.maxContextTokens` было фиксированным (4096), и на модели с окном 32k–128k
// история резалась в разы сильнее возможного — пользователю предлагалось поднимать настройку вручную.

import 'mocha';
import * as assert from 'assert';
import { knownContextWindow, reserveForAnswer, resolveContextTokens } from '../../src/shared/contextWindow';

suite('contextWindow', () => {
  test('CW-1: окно модели известно (32k) → уходит больше 4096 токенов', () => {
    const r = resolveContextTokens({ model: 'qwen2.5-coder:14b' });
    assert.strictEqual(r.source, 'known');
    assert.strictEqual(r.window, 32768);
    assert.ok(r.tokens > 4096, `ожидалось больше 4096, получено ${r.tokens}`);
    assert.ok(r.tokens <= 32768 - 512, 'резерв под ответ соблюдён');
  });

  test('CW-2: провайдер сообщил окно — его значение приоритетнее таблицы', () => {
    const r = resolveContextTokens({ model: 'gpt-4o', providerWindow: 8192 });
    assert.strictEqual(r.source, 'provider');
    assert.strictEqual(r.window, 8192);
    assert.ok(r.tokens < 8192);
  });

  test('CW-3: окно неизвестно и потолок не задан → историческое поведение 4096', () => {
    const r = resolveContextTokens({ model: 'unknown-model-xyz' });
    assert.strictEqual(r.source, 'fallback');
    assert.strictEqual(r.tokens, 4096);
  });

  test('CW-4: явный потолок сужает окно, но не расширяет его', () => {
    const narrow = resolveContextTokens({ model: 'gpt-4o', configured: 2000 });
    assert.strictEqual(narrow.tokens, 2000, 'потолок меньше окна — уважаем потолок');
    const wide = resolveContextTokens({ model: 'qwen2.5-coder:14b', configured: 1_000_000 });
    assert.ok(wide.tokens <= 32768, `потолок не может расширить окно модели: ${wide.tokens}`);
  });

  test('CW-5: потолок без известного окна используется как есть', () => {
    const r = resolveContextTokens({ model: 'unknown-model-xyz', configured: 12345 });
    assert.strictEqual(r.tokens, 12345);
    assert.strictEqual(r.source, 'setting');
  });

  test('CW-6: резерв под ответ растёт с окном, но не съедает всё', () => {
    assert.strictEqual(reserveForAnswer(4096), 614);
    assert.strictEqual(reserveForAnswer(128_000), 4096, 'больше 4096 не резервируем');
    assert.ok(reserveForAnswer(8192) >= 512);
  });

  test('CW-7: таблица знает окна основных семейств', () => {
    assert.strictEqual(knownContextWindow('gpt-4o-mini'), 128_000);
    assert.strictEqual(knownContextWindow('claude-sonnet-4'), 200_000);
    assert.strictEqual(knownContextWindow('deepseek-chat'), 65_536);
    assert.strictEqual(knownContextWindow(''), undefined);
  });
});
