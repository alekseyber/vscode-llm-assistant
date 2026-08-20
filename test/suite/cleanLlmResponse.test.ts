// Тесты cleanLlmResponse — очистка ответа LLM от ```code``` обрамления (Edit Mode + Autocomplete)

import 'mocha';
import * as assert from 'assert';
import { cleanLlmResponse } from '../../src/shared/cleanLlmResponse';

suite('cleanLlmResponse', () => {
  test('убирает обрамление ```code``` с указанием языка', () => {
    assert.strictEqual(cleanLlmResponse('```typescript\nconst a = 1;\n```'), 'const a = 1;');
  });

  test('убирает обрамление ``` без языка', () => {
    assert.strictEqual(cleanLlmResponse('```\ncode\n```'), 'code');
  });

  test('убирает обрамление для c++ (язык с +)', () => {
    assert.strictEqual(cleanLlmResponse('```c++\nint x = 0;\n```'), 'int x = 0;');
  });

  test('обрезает пробелы вокруг ответа', () => {
    assert.strictEqual(cleanLlmResponse('  код без обрамления  '), 'код без обрамления');
  });

  test('возвращает текст как есть, если нет обрамления', () => {
    assert.strictEqual(cleanLlmResponse('просто текст'), 'просто текст');
  });

  test('пустой ответ → пустая строка', () => {
    assert.strictEqual(cleanLlmResponse(''), '');
  });
});
