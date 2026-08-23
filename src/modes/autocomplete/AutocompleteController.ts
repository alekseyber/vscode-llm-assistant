// AutocompleteController — управление автокомплитом через LLM
// Провайдер inline-завершений (GhostTextManager) сам собирает контекст и шлёт LLM-запрос;
// контроллер держит настройки, тумблер вкл/выкл и команды accept/dismiss.

import * as vscode from 'vscode';
import { ProviderManager } from '../../providers/manager';
import { AutocompleteContext } from './ContextBuilder';
import { GhostTextManager } from './GhostTextManager';
import { cleanLlmResponse } from '../../shared/cleanLlmResponse';
import { isAbortError } from '../../shared/RetryHandler';

/**
 * AutocompleteController — контроллер автокомплита (ghost text).
 *
 * Flow:
 * 1. Пользователь печатает текст
 * 2. VS Code (своим debounce) вызывает provideInlineCompletionItems
 * 3. Провайдер собирает контекст и асинхронно шлёт LLM-запрос
 * 4. Ответ LLM показывается как ghost text (InlineCompletionItem)
 * 5. Tab — принять, Escape — отклонить
 */
export class AutocompleteController {
  private providerManager: ProviderManager;
  private ghostTextManager: GhostTextManager;
  private disposables: vscode.Disposable[] = [];

  /** Настройки по умолчанию */
  private enabled = true;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
    this.ghostTextManager = new GhostTextManager(
      (ctx, signal) => this.requestCompletion(ctx, signal),
      () => this.enabled,
    );

    // Читаем настройки из конфигурации VS Code
    this.readSettings();

    // Подписываемся на изменение конфигурации
    const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('llmAssistant.autocomplete')) {
        this.readSettings();
      }
    });
    this.disposables.push(configDisposable);

    // Команда llmAssistant.autocomplete.toggle регистрируется централизованно
    // в registerCommands.ts — здесь не дублируем, чтобы избежать ошибки
    // "Command already exists" в VS Code extension host.

    // Регистрируем команду принятия предложения
    const acceptDisposable = vscode.commands.registerCommand(
      'llmAssistant.autocomplete.accept',
      () => this.handleAccept(),
    );
    this.disposables.push(acceptDisposable);

    // Регистрируем команду отклонения предложения
    const dismissDisposable = vscode.commands.registerCommand(
      'llmAssistant.autocomplete.dismiss',
      () => this.handleDismiss(),
    );
    this.disposables.push(dismissDisposable);

    console.log('[AutocompleteController] Инициализирован (async-провайдер)');
  }

  /**
   * Прочитать настройки автокомплита из конфигурации VS Code.
   */
  private readSettings(): void {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    this.enabled = config.get<boolean>('autocomplete.enabled', true);
  }

  /**
   * Отправить запрос к LLM на автокомплит.
   *
   * @param context - контекст (префикс, суффикс, язык)
   * @param signal - сигнал отмены (из CancellationToken VS Code)
   * @returns текст предложения или null
   */
  private async requestCompletion(context: AutocompleteContext, signal?: AbortSignal): Promise<string | null> {
    const provider = this.providerManager.getDefault();
    if (!provider) {
      return null;
    }

    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = config.get<string>('defaultModel') ?? 'gpt-4o';

    // Формируем промпт для автокомплита
    const systemPrompt = `Ты — автокомплит для кода в VS Code.
Продолжи код в позиции курсора.
Верни ТОЛЬКО продолжение кода (текст, который будет вставлен на место курсора).
Не повторяй код, который уже есть в файле.
Не используй обрамление \`\`\` или другие пояснения.
Ответ должен быть коротким (не более 5-10 строк).`;

    const userPrompt = `Файл: ${context.filePath}
Язык: ${context.languageId}

Код до курсора:
\`\`\`
${context.prefix}
\`\`\`

Код после курсора:
\`\`\`
${context.suffix}
\`\`\`

Продолжи код в позиции курсора (между префиксом и суффиксом):`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    try {
      // Отправляем запрос (провайдер всегда стримит, собираем полный ответ)
      const stream = provider.chat(
        messages,
        { model, stream: true, temperature: 0.3, maxTokens: 128 },
        signal,
      );

      let fullResponse = '';
      for await (const chunk of stream) {
        fullResponse += chunk;
        // Ограничение: не больше 1024 символов для автокомплита
        if (fullResponse.length > 1024) {
          break;
        }
      }

      // Очищаем ответ от лишних обрамлений
      return cleanLlmResponse(fullResponse);
    } catch (error: any) {
      if (isAbortError(error)) {
        return null;
      }
      console.error('[AutocompleteController] Ошибка LLM запроса:', error);
      return null;
    }
  }

  /**
   * Обработать Accept (Tab).
   * VS Code сам обрабатывает Tab для InlineCompletionItem,
   * добавляем явную обработку для сброса кэша.
   */
  private handleAccept(): void {
    this.ghostTextManager.clearSuggestion();
  }

  /**
   * Обработать Dismiss (Escape).
   * Очищает кэш предложения (запрос прерывается через CancellationToken).
   */
  private handleDismiss(): void {
    this.ghostTextManager.clearSuggestion();
  }

  /**
   * Переключить состояние автокомплита (вкл/выкл).
   * Вызывается командой llmAssistant.autocomplete.toggle
   * (регистрируется централизованно в registerCommands.ts).
   */
  public toggleAutocomplete(): void {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const current = config.get<boolean>('autocomplete.enabled', true);
    config.update('autocomplete.enabled', !current, vscode.ConfigurationTarget.Global);
    this.enabled = !current;

    // Если отключили — очищаем кэш
    if (!this.enabled) {
      this.ghostTextManager.clearSuggestion();
    }

    vscode.window.showInformationMessage(
      `Автокомплит: ${this.enabled ? 'включён' : 'выключен'}`,
    );
  }

  /**
   * Освободить ресурсы при деактивации.
   */
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.ghostTextManager.dispose();
    console.log('[AutocompleteController] Деактивирован');
  }
}
