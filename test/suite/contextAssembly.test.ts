// Сборка контекста запроса: тот же код, что уходит модели из панели чата.
//
// Мотив: стенд evals собирал контекст своими руками и проверял модель на вырезанном
// фрагменте. Теперь сборка вынесена в чистую функцию, и панель, и стенд идут одним путём —
// значит ошибка в сборке контекста может уронить стенд, а не только тесты.

import 'mocha';
import * as assert from 'assert';
import {
  assembleRequestMessages,
  estimateTokens,
  formatCodeContext,
  systemPromptWithAgents,
  ContextMessage,
} from '../../src/shared/contextAssembly';

const file = (name: string, content: string) => ({ filePath: name, content });

suite('contextAssembly', () => {
  test('CA-1: контекст файла размечен заголовком и ограждением', () => {
    const block = formatCodeContext(file('src/a.ts', 'const a = 1;'));
    assert.ok(block.includes('--- Файл: src/a.ts ---'), 'имя файла в заголовке');
    assert.ok(block.includes('```'), 'код в ограждении');
    assert.ok(block.includes('const a = 1;'), 'содержимое на месте');
    assert.strictEqual(formatCodeContext(undefined), '', 'без контекста — пусто');
    assert.strictEqual(formatCodeContext(file('x.ts', '')), '', 'пустой файл не даёт блока');
  });

  test('CA-2: контекст приклеивается к сообщению пользователя, а не отдельным сообщением', () => {
    const messages: ContextMessage[] = [
      { role: 'user', content: 'что делает функция?', context: file('src/a.ts', 'export function f() {}') },
    ];
    const r = assembleRequestMessages({ systemPrompt: 'SYS', messages, maxTokens: 1000 });
    assert.strictEqual(r.messages.length, 2, 'system + одно сообщение');
    assert.strictEqual(r.messages[1].role, 'user');
    assert.ok(r.messages[1].content.startsWith('что делает функция?'), 'вопрос впереди');
    assert.ok(r.messages[1].content.includes('--- Файл: src/a.ts ---'), 'контекст в том же сообщении');
  });

  test('CA-3: контекст учитывается в бюджете — иначе он молча вытесняет историю', () => {
    // Раскладка подобрана так, что исход зависит ТОЛЬКО от учёта контекста:
    //   с контекстом последнее сообщение весит 44 токена (> бюджета 30) → старое обрезается;
    //   без учёта контекста оно весит 4 → старое влезает (4 + 20 ≤ 30) и не обрезается.
    const messages: ContextMessage[] = [
      { role: 'user', content: 'x'.repeat(80) },                                   // 20 токенов
      { role: 'user', content: 'второй вопрос', context: file('src/big.ts', 'y'.repeat(160)) }, // 4 + 40
    ];
    const r = assembleRequestMessages({ systemPrompt: '', messages, maxTokens: 30 });
    assert.strictEqual(r.trimmed.length, 1, 'старое сообщение вытеснено контекстом — значит контекст учтён');
    assert.strictEqual(r.messages.length, 2, 'system + последнее сообщение');
    assert.ok(r.messages[1].content.includes('--- Файл: src/big.ts ---'), 'контекст остался у последнего');
  });

  test('CA-4: последнее сообщение остаётся даже когда не влезает целиком', () => {
    const messages: ContextMessage[] = [
      { role: 'user', content: 'огромный вопрос '.repeat(100) },
    ];
    const r = assembleRequestMessages({ systemPrompt: '', messages, maxTokens: 10 });
    assert.strictEqual(r.messages.length, 2, 'запрос не остаётся без вопроса');
    assert.strictEqual(r.trimmed.length, 0, 'единственное сообщение не считается обрезанным');
  });

  test('CA-5: правила проекта дописываются в системный промпт тем же разделителем', () => {
    assert.strictEqual(systemPromptWithAgents('SYS', undefined), 'SYS', 'без AGENTS.md — как было');
    assert.strictEqual(systemPromptWithAgents('SYS', ''), 'SYS', 'пустой AGENTS.md не добавляет раздел');
    const withRules = systemPromptWithAgents('SYS', '# Правила');
    assert.ok(withRules.startsWith('SYS'), 'промпт впереди');
    assert.ok(withRules.includes('## Правила проекта:'), 'заголовок на месте');
    assert.ok(withRules.endsWith('# Правила'), 'правила в конце');
  });

  test('CA-6: обрезанные сообщения идут от старых к новым и без контекста файлов', () => {
    const messages: ContextMessage[] = [
      { role: 'user', content: 'A', context: file('a.ts', 'aaa') },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C '.repeat(50) },
    ];
    const r = assembleRequestMessages({ systemPrompt: '', messages, maxTokens: 5 });
    assert.deepStrictEqual(r.trimmed.map(m => m.content.slice(0, 1)), ['A', 'B'], 'порядок: старые первыми');
    assert.ok(!r.trimmed[0].content.includes('--- Файл'), 'в summary контекст файла не нужен');
  });

  test('CA-7: оценка токенов одна на всех — 4 символа на токен', () => {
    assert.strictEqual(estimateTokens('abcd'), 1);
    assert.strictEqual(estimateTokens('abcde'), 2);
    const r = assembleRequestMessages({
      systemPrompt: 'abcd',
      messages: [{ role: 'user', content: 'abcd' }],
      maxTokens: 2,
    });
    assert.strictEqual(r.systemPrompt, 'abcd');
  });
});
