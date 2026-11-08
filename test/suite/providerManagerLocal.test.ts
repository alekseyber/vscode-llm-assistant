// Тесты ProviderManager для локального провайдера (Stage 2).
// AC: PRM-1.1, PRM-1.2, PRM-1.3, PRM-1.4, PRM-1.5
// Плюс обратная совместимость: конфиг без type ведёт себя как раньше.

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { ProviderManager, DEFAULT_OLLAMA_BASE_URL } from '../../src/providers/manager';
import { OllamaProvider } from '../../src/providers/ollama';
import { OpenAIProvider } from '../../src/providers/openai';
import { calculateCost } from '../../src/providers/types';

suite('ProviderManager — локальный провайдер', () => {
  let sandbox: sinon.SinonSandbox;

  const cloudProvider = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    models: ['deepseek-chat'],
  };

  function createMockVscodeConfig(state: { providers: Record<string, unknown>; defaultProvider?: string }) {
    const mockConfig = {
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'providers') return state.providers;
        if (key === 'defaultProvider') return state.defaultProvider ?? 'openai';
        if (key === 'defaultModel') return 'gpt-4o';
        if (key === 'debug') return false;
        return defaultValue;
      },
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
  }

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('PRM-1.1: type "ollama" создаёт OllamaProvider с isLocal', () => {
    createMockVscodeConfig({
      providers: {
        local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3:8b'] },
      },
    });

    const manager = new ProviderManager();
    const provider = manager.getProvider('local');

    assert.ok(provider instanceof OllamaProvider, 'должен быть создан OllamaProvider');
    assert.strictEqual((provider as OllamaProvider).isLocal, true);
  });

  test('PRM-1.2: конфиг без type → OpenAIProvider (обратная совместимость)', () => {
    createMockVscodeConfig({ providers: { deepseek: cloudProvider } });

    const manager = new ProviderManager();
    const provider = manager.getProvider('deepseek');

    assert.ok(provider instanceof OpenAIProvider, 'облачный провайдер остаётся OpenAIProvider');
    assert.notStrictEqual((provider as any).isLocal, true);
  });

  test('PRM-1.3: type описан в конфиге; отсутствие baseUrl даёт адрес по умолчанию', () => {
    createMockVscodeConfig({ providers: { local: { type: 'ollama', models: [] } } });

    const manager = new ProviderManager();
    const provider = manager.getProvider('local') as OllamaProvider;

    assert.ok(provider, 'провайдер создан даже без baseUrl');
    assert.strictEqual((provider as any).baseUrl, DEFAULT_OLLAMA_BASE_URL);
    assert.strictEqual(DEFAULT_OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
  });

  test('PRM-1.4: локальные модели стоят 0, облачные — по прежней цене', () => {
    createMockVscodeConfig({
      providers: {
        local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3:8b', 'gemma3:4b'] },
        deepseek: cloudProvider,
      },
    });

    const manager = new ProviderManager();
    const pricing = manager.pricingMap;

    assert.deepStrictEqual(pricing.get('qwen3:8b'), { input: 0, output: 0 }, 'локальная модель бесплатна');
    assert.strictEqual(calculateCost('qwen3:8b', 10000, 5000, pricing), 0, 'выдуманной стоимости нет');
    assert.deepStrictEqual(pricing.get('deepseek-chat'), { input: 0.14, output: 0.28 }, 'облачная цена не затёрта');
  });

  test('PRM-1.4: setZeroPricing обнуляет модели, пришедшие из discovery', () => {
    createMockVscodeConfig({ providers: { local: { type: 'ollama', models: [] } } });

    const manager = new ProviderManager();
    assert.strictEqual(manager.pricingMap.get('mistral:7b'), undefined);

    manager.setZeroPricing(['mistral:7b']);

    assert.deepStrictEqual(manager.pricingMap.get('mistral:7b'), { input: 0, output: 0 });
    assert.strictEqual(calculateCost('mistral:7b', 1000, 1000, manager.pricingMap), 0);
  });

  test('PRM-1.5: неизвестный type пропускает провайдера, остальные создаются', () => {
    createMockVscodeConfig({
      providers: {
        broken: { type: 'anthropic-native', baseUrl: 'http://x', models: ['x'] },
        deepseek: cloudProvider,
        local: { type: 'ollama', models: ['qwen3:8b'] },
      },
    });

    const manager = new ProviderManager();

    assert.strictEqual(manager.getProvider('broken'), undefined, 'неизвестный type не создан');
    assert.ok(manager.getProvider('deepseek') instanceof OpenAIProvider);
    assert.ok(manager.getProvider('local') instanceof OllamaProvider);
    assert.strictEqual(manager.getAllProviders().size, 2);
  });

  test('PRM-1.1: локальный провайдер не требует apiKey', () => {
    createMockVscodeConfig({ providers: { local: { type: 'ollama', models: ['qwen3:8b'] } } });

    assert.doesNotThrow(() => {
      const manager = new ProviderManager();
      assert.ok(manager.getProvider('local'));
    });
  });

  test('PRM-1.4 (регрессия ручного прогона): нули переживают refresh() после правки настроек', () => {
    const state: { providers: Record<string, unknown> } = {
      providers: { local: { type: 'ollama', models: [] } },
    };
    const mockConfig = {
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'providers') return state.providers;
        if (key === 'debug') return false;
        return defaultValue;
      },
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    const manager = new ProviderManager();
    // Так делает ChatViewProvider после discovery: у провайдера models: [] в конфиге
    manager.setZeroPricing(['gemma3:4b', 'qwen3:8b']);
    assert.strictEqual(calculateCost('gemma3:4b', 768, 40, manager.pricingMap), 0);

    // Пользователь правит settings.json (например включает local.think) → refresh()
    manager.refresh();

    assert.strictEqual(
      calculateCost('gemma3:4b', 768, 40, manager.pricingMap),
      0,
      'после refresh() цена локальной модели осталась нулевой (баг 0.0004)',
    );
    assert.deepStrictEqual(manager.pricingMap.get('qwen3:8b'), { input: 0, output: 0 });
  });
});
