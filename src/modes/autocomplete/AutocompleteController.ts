// AutocompleteController — управление автокомплитом через LLM
// Подписка на onDidChangeTextDocument с debounce 500ms → ContextBuilder → LLM запрос → GhostTextManager

import * as vscode from 'vscode';
import { ProviderManager } from '../../providers/manager';
import { ContextBuilder, AutocompleteContext } from './ContextBuilder';
import { GhostTextManager } from './GhostTextManager';

/**
 * AutocompleteController — контроллер автокомплита (ghost text).
 *
 * Flow:
 * 1. Пользователь печатает текст
 * 2. После паузы (debounce 500ms) собирается контекст
 * 3. Отправляется запрос к LLM с префиксом/суффиксом
 * 4. Ответ LLM показывается как ghost text (InlineCompletionItem)
 * 5. Tab — принять, Escape — отклонить
 */
export class AutocompleteController {
  private providerManager: ProviderManager;
  private contextBuilder: ContextBuilder;
  private ghostTextManager: GhostTextManager;
  private disposables: vscode.Disposable[] = [];

  /** Таймер debounce */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Текущий AbortController для отмены запроса */
  private abortController: AbortController | null = null;
  /** Флаг: выполняется ли запрос */
  private isRequestInFlight = false;

  /** Настройки по умолчанию */
  private enabled = true;
  private debounceMs = 500;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
    this.contextBuilder = new ContextBuilder();
    this.ghostTextManager = new GhostTextManager();

    // Читаем настройки из конфигурации VS Code
    this.readSettings();

    // Подписываемся на изменение текста документа
    const changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      this.handleTextChange(e);
    });
    this.disposables.push(changeDisposable);

    // Подписываемся на изменение конфигурации
    const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('llmAssistant.autocomplete')) {
        this.readSettings();
      }
    });
    this.disposables.push(configDisposable);

    // Регистрируем команду переключения автокомплита
    const toggleDisposable = vscode.commands.registerCommand(
      'llmAssistant.autocomplete.toggle',
      () => this.toggleAutocomplete()
    );
    this.disposables.push(toggleDisposable);

    // Регистрируем команду принятия предложения
    const acceptDisposable = vscode.commands.registerCommand(
      'llmAssistant.autocomplete.accept',
      () => this.handleAccept()
    );
    this.disposables.push(acceptDisposable);

    // Регистрируем команду отклонения предложения
    const dismissDisposable = vscode.commands.registerCommand(
      'llmAssistant.autocomplete.dismiss',
      () => this.handleDismiss()
    );
    this.disposables.push(dismissDisposable);

    console.log('[AutocompleteController] Инициализирован');
  }

  /**
   * Прочитать настройки автокомплита из конфигурации VS Code.
   */
  private readSettings(): void {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    this.enabled = config.get<boolean>('autocomplete.enabled', true);
    this.debounceMs = config.get<number>('autocomplete.debounceMs', 500);
  }

  /**
   * Обработать изменение текста документа.
   * Запускает debounce таймер.
   *
   * @param event - событие изменения текста
   */
  private handleTextChange(event: vscode.TextDocumentChangeEvent): void {
    // Если автокомплит отключён — игнорируем
    if (!this.enabled) {
      return;
    }

    // Игнорируем изменения в неактивных редакторах
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }

    // Проверяем, что документ — файл (не output, terminal, etc.)
    if (event.document.uri.scheme !== 'file') {
      return;
    }

    // Сбрасываем предыдущий таймер
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Отменяем предыдущий запрос, если он был
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRequestInFlight = false;

    // Запускаем новый таймер
    this.debounceTimer = setTimeout(() => {
      this.triggerAutocomplete();
    }, this.debounceMs);
  }

  /**
   * Запустить запрос автокомплита.
   * Собирает контекст, отправляет запрос к LLM, показывает результат.
   */
  private async triggerAutocomplete(): Promise<void> {
    if (this.isRequestInFlight) return;
    this.isRequestInFlight = true;

    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      // Собираем контекст
      const context = this.contextBuilder.build(editor);
      if (!context || (!context.prefix && !context.suffix)) {
        return;
      }

      // Отправляем запрос к LLM
      const suggestion = await this.requestCompletion(context);
      if (!suggestion || suggestion.trim().length === 0) {
        return;
      }

      // Создаём диапазон для вставки предложения (от текущей позиции курсора)
      const position = editor.selection.active;
      const range = new vscode.Range(position, position);

      // Показываем ghost text
      const uri = editor.document.uri.toString();
      const shown = this.ghostTextManager.setSuggestion(suggestion, range, uri);
      if (shown) {
        console.log('[AutocompleteController] Ghost text показан');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[AutocompleteController] Запрос отменён');
      } else {
        console.error('[AutocompleteController] Ошибка:', error.message);
      }
    } finally {
      this.isRequestInFlight = false;
    }
  }

  /**
   * Отправить запрос к LLM на автокомплит.
   *
   * @param context - контекст (префикс, суффикс, язык)
   * @returns текст предложения или null
   */
  private async requestCompletion(context: AutocompleteContext): Promise<string | null> {
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

    // Создаём AbortController для возможности отмены
    this.abortController = new AbortController();

    try {
      // Отправляем запрос (провайдер всегда стримит, собираем полный ответ)
      const stream = provider.chat(
        messages,
        { model, stream: true, temperature: 0.3, maxTokens: 128 },
        this.abortController.signal
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
      return this.cleanLlmResponse(fullResponse);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return null;
      }
      console.error('[AutocompleteController] Ошибка LLM запроса:', error);
      return null;
    }
  }

  /**
   * Очистить ответ LLM от лишних обрамлений и лишнего текста.
   *
   * @param response - сырой ответ от LLM
   * @returns очищенный текст
   */
  private cleanLlmResponse(response: string): string {
    let cleaned = response.trim();

    // Убираем обрамление ```code``` если есть
    const codeBlockRegex = /^```(?:[\w+-]+)?\s*\n?([\s\S]*?)\n?```$/;
    const match = cleaned.match(codeBlockRegex);
    if (match) {
      cleaned = match[1].trim();
    }

    // Убираем одинарные обрамления ```
    if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
      cleaned = cleaned.slice(3, -3).trim();
    }

    return cleaned;
  }

  /**
   * Обработать Accept (Tab).
   * VS Code сам обрабатывает Tab для InlineCompletionItem,
   * добавляем явную обработку для синхронизации состояния.
   */
  private handleAccept(): void {
    this.ghostTextManager.clearSuggestion();
  }

  /**
   * Обработать Dismiss (Escape).
   * Очищает ghost text и отменяет текущий запрос, если есть.
   */
  private handleDismiss(): void {
    this.ghostTextManager.clearSuggestion();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Переключить состояние автокомплита (вкл/выкл).
   * Вызывается командой llmAssistant.autocomplete.toggle.
   */
  private toggleAutocomplete(): void {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const current = config.get<boolean>('autocomplete.enabled', true);
    config.update('autocomplete.enabled', !current, vscode.ConfigurationTarget.Global);
    this.enabled = !current;

    // Если отключили — очищаем ghost text и отменяем запрос
    if (!this.enabled) {
      this.ghostTextManager.clearSuggestion();
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    vscode.window.showInformationMessage(
      `Автокомплит: ${this.enabled ? 'включён' : 'выключен'}`
    );
  }

  /**
   * Освободить ресурсы при деактивации.
   */
  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.ghostTextManager.dispose();
    console.log('[AutocompleteController] Деактивирован');
  }
}