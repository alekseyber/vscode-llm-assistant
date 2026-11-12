// Тесты модуля thinking (Stage 4).
// AC: TH-1.1, TH-1.2, TH-1.3, TH-1.4
// До 0.14.0 у buildThinkingExtraBody не было ни одного теста — пробел закрывается здесь.

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { buildThinkingExtraBody, shouldDisableThinking } from '../../src/shared/thinking';

suite('thinking: два механизма гашения рассуждения', () => {
  let sandbox: sinon.SinonSandbox;
  let disableThinking = false;

  function stubConfig(): void {
    const mockConfig = {
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'disableThinking') return disableThinking;
        if (key === 'debug') return false;
        return defaultValue;
      },
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);
  }

  setup(() => {
    sandbox = sinon.createSandbox();
    disableThinking = false;
    stubConfig();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('TH-1.1: deepseek + disableThinking:true → thinking disabled', () => {
    disableThinking = true;
    assert.deepStrictEqual(buildThinkingExtraBody('deepseek-v4-flash'), { thinking: { type: 'disabled' } });
  });

  test('TH-1.1: disableThinking:false (дефолт) → undefined', () => {
    assert.strictEqual(buildThinkingExtraBody('deepseek-v4-flash'), undefined);
  });

  test('TH-1.1: не-deepseek модель → undefined', () => {
    disableThinking = true;
    assert.strictEqual(buildThinkingExtraBody('gpt-4o'), undefined);
  });

  test('TH-1.2: локальная модель не получает extraBody (гасится нативно)', () => {
    disableThinking = true;
    // У локальной модели имя не содержит deepseek, и даже если бы содержало —
    // рассуждение гасится флагом `think` в OllamaProvider, а не телом запроса.
    assert.strictEqual(buildThinkingExtraBody('qwen3:8b'), undefined);
    assert.strictEqual(buildThinkingExtraBody('gemma3:4b'), undefined);
  });

  test('TH-1.3: shouldDisableThinking — таблица решений', () => {
    const cases: Array<[string, Parameters<typeof shouldDisableThinking>[0], boolean]> = [
      ['локальная модель', { model: 'qwen3:8b', isLocal: true, disableThinking: false }, true],
      ['локальная + always', { model: 'qwen3:8b', isLocal: true, disableThinking: false, always: true }, true],
      ['deepseek + always (автокомплит)', { model: 'deepseek-v4-flash', disableThinking: false, always: true }, true],
      ['deepseek + disableThinking', { model: 'deepseek-v4-flash', disableThinking: true }, true],
      ['deepseek без настроек', { model: 'deepseek-v4-flash', disableThinking: false }, false],
      ['облачная не-deepseek', { model: 'gpt-4o', disableThinking: true, always: true }, false],
    ];

    for (const [label, input, expected] of cases) {
      assert.strictEqual(shouldDisableThinking(input), expected, label);
    }
  });

  test('TH-1.4: для локального провайдера extraBody не формируется', () => {
    // Так делает AutocompleteController: решение принимает shouldDisableThinking,
    // но extraBody отправляется только облачному deepseek.
    const isLocal = true;
    const needsThinking = shouldDisableThinking({ model: 'qwen3:8b', isLocal, disableThinking: true, always: true });
    const extraBody = needsThinking && !isLocal ? { thinking: { type: 'disabled' } } : undefined;

    assert.strictEqual(needsThinking, true, 'решение «гасить» принято');
    assert.strictEqual(extraBody, undefined, 'но extraBody локальному не отправляется');

    const cloudNeeds = shouldDisableThinking({ model: 'deepseek-v4-flash', isLocal: false, disableThinking: true, always: true });
    const cloudBody = cloudNeeds && true ? { thinking: { type: 'disabled' } } : undefined;
    assert.deepStrictEqual(cloudBody, { thinking: { type: 'disabled' } }, 'облачному deepseek — отправляется');
  });
});
