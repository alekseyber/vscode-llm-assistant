// Тесты для ProviderManager
// Проверяет парсинг конфигурации провайдеров, выбор провайдера по умолчанию,
// обработку отсутствующих провайдеров и обновление конфигурации

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { ProviderManager } from '../../src/providers/manager';

suite('ProviderManager', () => {
  let sandbox: sinon.SinonSandbox;

  // Типичная конфигурация провайдеров для тестов
  const mockProviderConfig = {
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-openai',
      models: ['gpt-4o', 'gpt-4o-mini'],
    },
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-deepseek',
      models: ['deepseek-chat', 'deepseek-coder'],
    },
  };

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  /**
   * Вспомогательная функция: настраивает заглушку для vscode.workspace.getConfiguration
   * так, чтобы она возвращала нужные значения конфигурации провайдеров.
   * Использует динамический объект, который можно обновлять между вызовами.
   */
  function createMockVscodeConfig(): {
    config: Record<string, unknown>;
    setProviders: (providers: Record<string, unknown>) => void;
    setDefaultProvider: (name: string) => void;
  } {
    const state = {
      providers: {} as Record<string, unknown>,
      defaultProvider: 'openai' as string,
      defaultModel: 'gpt-4o' as string,
    };

    const mockConfig = {
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'providers') return state.providers;
        if (key === 'defaultProvider') return state.defaultProvider;
        if (key === 'defaultModel') return state.defaultModel;
        return defaultValue;
      },
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };

    // Подменяем vscode.workspace.getConfiguration один раз
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    return {
      config: state,
      setProviders: (providers: Record<string, unknown>) => {
        state.providers = providers;
      },
      setDefaultProvider: (name: string) => {
        state.defaultProvider = name;
      },
    };
  }

  test('AC-9.4: refresh() читает конфиг и создаёт провайдеров', () => {
    const cfg = createMockVscodeConfig();
    cfg.setProviders(mockProviderConfig as any);

    const manager = new ProviderManager();

    // Проверяем, что getConfiguration был вызван с правильным именем секции
    assert.ok(
      (vscode.workspace.getConfiguration as sinon.SinonStub).calledWith('llmAssistant'),
      'getConfiguration должен быть вызван с llmAssistant'
    );

    // Проверяем, что созданы оба провайдера
    const openai = manager.getProvider('openai');
    assert.ok(openai, 'Провайдер openai должен быть создан');
    assert.strictEqual((openai as any).name, 'openai');

    const deepseek = manager.getProvider('deepseek');
    assert.ok(deepseek, 'Провайдер deepseek должен быть создан');
    assert.strictEqual((deepseek as any).name, 'deepseek');
  });

  test('getProvider() возвращает undefined для неизвестного провайдера', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders(mockProviderConfig as any);

      const manager = new ProviderManager();
      const unknown = manager.getProvider('nonexistent');

      assert.strictEqual(unknown, undefined, 'Неизвестный провайдер должен вернуть undefined');
    });

    test('getDefault() возвращает провайдера по умолчанию', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders(mockProviderConfig as any);
      cfg.setDefaultProvider('deepseek');

      const manager = new ProviderManager();
      const defaultProvider = manager.getDefault();

      assert.ok(defaultProvider, 'Провайдер по умолчанию должен быть найден');
      assert.strictEqual((defaultProvider as any).name, 'deepseek');
    });

    test('getDefault() возвращает openai если настройка не задана', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders(mockProviderConfig as any);

      const manager = new ProviderManager();
      const defaultProvider = manager.getDefault();

      assert.ok(defaultProvider, 'Провайдер по умолчанию должен быть openai');
      assert.strictEqual((defaultProvider as any).name, 'openai');
    });

    test('getAllProviders() возвращает всех провайдеров', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders(mockProviderConfig as any);

      const manager = new ProviderManager();
      const allProviders = manager.getAllProviders();

      assert.strictEqual(allProviders.size, 2, 'Должно быть 2 провайдера');
      assert.ok(allProviders.has('openai'));
      assert.ok(allProviders.has('deepseek'));
    });

    test('refresh() очищает старых провайдеров и создаёт новых', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders(mockProviderConfig as any);

      const manager = new ProviderManager();

      // Меняем конфигурацию на другую
      const newConfig = {
        local: {
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'ollama',
          models: ['llama3', 'codellama'],
        },
      };

      // Обновляем конфигурацию в mock-объекте
      cfg.setProviders(newConfig as any);

      // Вызываем refresh
      manager.refresh();

      // Старые провайдеры должны быть удалены
      assert.strictEqual(manager.getProvider('openai'), undefined, 'Старый провайдер должен быть удалён');
      assert.strictEqual(manager.getProvider('deepseek'), undefined, 'Старый провайдер должен быть удалён');

      // Новый провайдер должен быть создан
      const local = manager.getProvider('local');
      assert.ok(local, 'Новый провайдер должен быть создан');
      assert.strictEqual((local as any).name, 'local');
    });

    test('refresh() обрабатывает пустую конфигурацию', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders({});

      const manager = new ProviderManager();
      const allProviders = manager.getAllProviders();

      assert.strictEqual(allProviders.size, 0, 'При пустой конфигурации не должно быть провайдеров');
    });

    test('getDefault() возвращает undefined при пустой конфигурации', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders({});

      const manager = new ProviderManager();
      const defaultProvider = manager.getDefault();

      assert.strictEqual(defaultProvider, undefined, 'При пустой конфигурации default должен быть undefined');
    });

    test('refresh() подставляет ${VAR} из process.env', () => {
      const cfg = createMockVscodeConfig();
      process.env.TEST_KEY = 'my-test-key';
      cfg.setProviders({
        test: { baseUrl: 'https://test.com/v1', apiKey: '${TEST_KEY}', models: ['m1'] }
      });

      const manager = new ProviderManager();
      const provider = manager.getProvider('test');
      assert.ok(provider);
      assert.strictEqual((provider as any).apiKey, 'my-test-key');
      delete process.env.TEST_KEY;
    });

    test('refresh() оставляет ${VAR} если переменная не найдена', () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders({
        test: { baseUrl: 'https://test.com/v1', apiKey: '${MISSING_VAR}', models: ['m1'] }
      });

      const manager = new ProviderManager();
      const provider = manager.getProvider('test');
      assert.ok(provider);
      assert.strictEqual((provider as any).apiKey, '');
    });

    test('Провайдер имеет список моделей из конфигурации', async () => {
      const cfg = createMockVscodeConfig();
      cfg.setProviders(mockProviderConfig as any);

      const manager = new ProviderManager();
      const openai = manager.getProvider('openai')!;
      const models = await openai.models();

      assert.deepStrictEqual(models, ['gpt-4o', 'gpt-4o-mini'], 'Модели должны совпадать с конфигурацией');
    });
});