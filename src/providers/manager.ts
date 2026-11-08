// Менеджер провайдеров — читает конфигурацию из VS Code settings
// и предоставляет доступ к провайдерам по имени

import * as vscode from 'vscode';
import { LLMProvider, ProviderConfig, ModelEntry, PricingMap, extractModelNames, buildPricingMap } from './types';
import { debugLog } from '../shared/logger';

/** Адрес Ollama по умолчанию, если в конфиге не задан baseUrl. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
import { OpenAIProvider } from './openai';
import { OllamaProvider } from './ollama';
import { isLocalBaseUrl } from './base';

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
 *     },
 *     "local": {
 *       "type": "ollama",
 *       "baseUrl": "http://127.0.0.1:11434",
 *       "models": []
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
  /** Карта цен моделей (из конфига + fallback) */
  private _pricingMap: PricingMap = new Map();
  /**
   * Модели локальных провайдеров (бесплатные). Живёт ОТДЕЛЬНО от `_pricingMap`,
   * потому что `refresh()` её очищает при любом изменении настроек: иначе после правки
   * settings.json локальная модель снова считалась бы по DEFAULT_PRICING ($0.50/$1.00).
   * Найдено ручным прогоном 0.14.0: «768+40 токенов = 0.0004» у gemma3:4b.
   */
  private readonly localModels = new Set<string>();

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
    this._pricingMap.clear();
    // localModels НЕ очищаем: имена локальных моделей не зависят от правки настроек,
    // а повторный discovery может быть недоступен в момент изменения конфигурации.

    for (const [name, providerCfg] of Object.entries(providersConfig)) {
      // Подстановка переменных окружения ${VAR}
      let apiKey = providerCfg.apiKey ?? '';
      apiKey = apiKey.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] || '');
      let baseUrl = providerCfg.baseUrl ?? '';
      baseUrl = baseUrl.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] || '');

      // Модели: могут быть строками или объектами с pricing
      const rawModels: ModelEntry[] = (providerCfg.models ?? []) as ModelEntry[];
      const modelNames = extractModelNames(rawModels);

      // Строим карту цен для этого провайдера и сливаем в общую
      const providerPricing = buildPricingMap(rawModels);
      for (const [m, p] of providerPricing) {
        this._pricingMap.set(m, p);
      }

      // Тип провайдера: отсутствие поля = 'openai' (обратная совместимость)
      const type = (providerCfg as any).type as 'openai' | 'ollama' | undefined;
      const supportsVision = (providerCfg as any).supportsVision ?? false;

      // Переопределения локальных настроек на уровне записи провайдера
      const overrides = {
        numCtx: (providerCfg as any).numCtx as number | undefined,
        think: (providerCfg as any).think as boolean | undefined,
        timeout: (providerCfg as any).timeout as number | undefined,
        toolLoop: (providerCfg as any).toolLoop as boolean | undefined,
      };
      // Локальность — по АДРЕСУ, а не по типу: рядом с Ollama живут OpenAI-совместимые
      // движки (llama.cpp, LM Studio, vLLM), и они подключаются записью type: 'openai'.
      const localByAddress = isLocalBaseUrl(baseUrl);

      if (type === 'ollama') {
        const local = new OllamaProvider({
          name,
          baseUrl: baseUrl || DEFAULT_OLLAMA_BASE_URL,
          apiKey,
          models: modelNames,
          supportsVision,
          overrides,
        });
        this.providers.set(name, local);
        // Локальные модели ничего не стоят: иначе calculateCost() возьмёт DEFAULT_PRICING
        // ($0.50/$1.00 за 1M) и покажет выдуманную стоимость в статистике токенов.
        this.setZeroPricing(modelNames);
        continue;
      }

      if (type !== undefined && type !== 'openai') {
        debugLog(`[manager] неизвестный type="${String(type)}" у провайдера "${name}" — провайдер пропущен`);
        continue;
      }

      const provider = new OpenAIProvider({
        name,
        baseUrl,
        apiKey,
        models: modelNames, // Только имена моделей (строки)
        supportsVision,
        isLocal: localByAddress,
        toolLoop: overrides.toolLoop,
      });
      this.providers.set(name, provider);
      if (localByAddress) {
        // Тот же дефект, что ловили на gemma3:4b: локальный движок с type:'openai'
        // без обнуления цен попадает в DEFAULT_PRICING и показывает выдуманную стоимость.
        this.setZeroPricing(modelNames);
      }
    }
  }

  /**
   * Обнулить цены моделей в `_pricingMap`.
   * Используется для локальных провайдеров — их модели не стоят денег, а `calculateCost()`
   * для неизвестной модели берёт `DEFAULT_PRICING`.
   */
  setZeroPricing(modelNames: string[]): void {
    for (const model of modelNames) {
      this.localModels.add(model);
      this._pricingMap.set(model, { input: 0, output: 0 });
    }
  }

  /** Получить карту цен моделей */
  get pricingMap(): PricingMap {
    if (this.localModels.size === 0) return this._pricingMap;
    // Накладываем нули поверх карты: локальные модели не стоят денег
    const merged = new Map(this._pricingMap);
    for (const model of this.localModels) merged.set(model, { input: 0, output: 0 });
    return merged;
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
   * Если провайдер по умолчанию не задан или не найден — берётся первый настроенный.
   * 
   * @returns LLMProvider по умолчанию или undefined, если провайдеров нет
   */
  getDefault(): LLMProvider | undefined {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const defaultProviderName = config.get<string>('defaultProvider') ?? 'openai';
    const provider = this.getProvider(defaultProviderName);
    if (provider) {
      return provider;
    }
    // Fallback: первый настроенный провайдер (если defaultProvider не сконфигурирован)
    return this.providers.values().next().value;
  }

  /**
   * Получить список всех зарегистрированных провайдеров
   * @returns Map<имя, LLMProvider>
   */
  getAllProviders(): Map<string, LLMProvider> {
    return new Map(this.providers);
  }
}