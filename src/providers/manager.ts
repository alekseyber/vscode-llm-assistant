// Менеджер провайдеров — читает конфигурацию из VS Code settings
// и предоставляет доступ к провайдерам по имени

import * as vscode from 'vscode';
import { LLMProvider, ProviderConfig } from './types';
import { OpenAIProvider } from './openai';

/**
 * ProviderManager — управляет всеми LLM-провайдерами.
 * 
 * Читает конфигурацию из `llmAssistant.providers` в settings.json VS Code.
 * Хранит Map<имя, LLMProvider> и предоставляет методы:
 * - getProvider(name) — получить провайдера по имени
 * - getDefault() — получить провайдера по умолчанию
 * - refresh() — перечитать конфигурацию и обновить список провайдеров
 * 
 * Формат конфигурации в settings.json:
 * ```json
 * {
 *   "llmAssistant.providers": {
 *     "openai": {
 *       "baseUrl": "https://api.openai.com/v1",
 *       "apiKey": "sk-...",
 *       "models": ["gpt-4o", "gpt-4o-mini"]
 *     },
 *     "deepseek": {
 *       "baseUrl": "https://api.deepseek.com/v1",
 *       "apiKey": "sk-...",
 *       "models": ["deepseek-chat", "deepseek-coder"]
 *     }
 *   },
 *   "llmAssistant.defaultProvider": "openai",
 *   "llmAssistant.defaultModel": "gpt-4o"
 * }
 * ```
 */
export class ProviderManager {
  /** Карта провайдеров: имя → LLMProvider */
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    // При создании сразу читаем конфигурацию
    this.refresh();
  }

  /**
   * Перечитать конфигурацию провайдеров из настроек VS Code.
   * Очищает текущий список и создаёт новые провайдеры на основе settings.json.
   * Вызывается автоматически при создании менеджера и может быть вызван
   * вручную при изменении настроек (через onDidChangeConfiguration).
   */
  refresh(): void {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const providersConfig = config.get<Record<string, Omit<ProviderConfig, 'name'>>>('providers') ?? {};

    this.providers.clear();

    for (const [name, providerCfg] of Object.entries(providersConfig)) {
      // Сейчас поддерживаются только OpenAI-совместимые провайдеры
      const provider = new OpenAIProvider({
        name,
        baseUrl: providerCfg.baseUrl ?? '',
        apiKey: providerCfg.apiKey ?? '',
        models: providerCfg.models ?? [],
      });
      this.providers.set(name, provider);
    }
  }

  /**
   * Получить провайдера по имени
   * @param name - имя провайдера (например, 'openai', 'deepseek')
   * @returns LLMProvider или undefined, если провайдер с таким именем не найден
   */
  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Получить провайдера по умолчанию.
   * Использует значение настройки llmAssistant.defaultProvider.
   * Если настройка не задана, возвращается провайдер 'openai'.
   * 
   * @returns LLMProvider по умолчанию или undefined, если не найден
   */
  getDefault(): LLMProvider | undefined {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const defaultProviderName = config.get<string>('defaultProvider') ?? 'openai';
    return this.getProvider(defaultProviderName);
  }

  /**
   * Получить список всех зарегистрированных провайдеров
   * @returns Map<имя, LLMProvider>
   */
  getAllProviders(): Map<string, LLMProvider> {
    return new Map(this.providers);
  }
}