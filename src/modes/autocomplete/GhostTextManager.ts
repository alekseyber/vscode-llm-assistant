// GhostTextManager — управление ghost text (InlineCompletionItemProvider)
// Async-провайдер: VS Code вызывает provideInlineCompletionItems при паузе ввода,
// провайдер сам собирает контекст, шлёт LLM-запрос и возвращает InlineCompletionItem.
// Кэш: не предлагает то же самое 2 раза подряд.

import * as vscode from 'vscode';
import { ContextBuilder, AutocompleteContext } from './ContextBuilder';

/**
 * GhostTextManager — реализует InlineCompletionItemProvider для VS Code.
 *
 * Отвечает за:
 * - Сбор контекста (ContextBuilder) и LLM-запрос прямо в провайдере
 * - Показ ghost text (InlineCompletionItem)
 * - Кэш: не дублировать одинаковые предложения
 * - Отмену запроса при изменении документа (CancellationToken → AbortSignal)
 */
export class GhostTextManager implements vscode.InlineCompletionItemProvider {
  private readonly contextBuilder = new ContextBuilder();
  private readonly requestCompletion: (ctx: AutocompleteContext, signal?: AbortSignal) => Promise<string | null>;
  private readonly isEnabled: () => boolean;
  private disposables: vscode.Disposable[] = [];

  /** Кэш: последнее показанное предложение (URI + текст) */
  private lastSuggestion: string | null = null;
  private lastUri: string | null = null;

  constructor(
    requestCompletion: (ctx: AutocompleteContext, signal?: AbortSignal) => Promise<string | null>,
    isEnabled: () => boolean,
  ) {
    this.requestCompletion = requestCompletion;
    this.isEnabled = isEnabled;

    // Регистрируем себя как провайдер для всех текстовых документов
    const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      this,
    );
    this.disposables.push(providerDisposable);
  }

  /**
   * Реализация InlineCompletionItemProvider (async).
   * Вызывается VS Code, когда нужно показать inline-завершение.
   * Собирает контекст и асинхронно запрашивает LLM — VS Code ждёт Promise.
   *
   * @param document - документ, в котором происходит редактирование
   * @param position - позиция курсора
   * @param context - контекст завершения
   * @param token - токен отмены (прерывается при продолжении ввода)
   * @returns список inline-завершений или null
   */
  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | null> {
    // Автокомплит выключен — молчим
    if (!this.isEnabled()) {
      return null;
    }

    // Работаем только с реальными файлами (не output/terminal/diff)
    if (document.uri.scheme !== 'file') {
      return null;
    }

    if (token.isCancellationRequested) {
      return null;
    }

    // Собираем контекст
    const ctx = this.contextBuilder.build(document, position);
    if (!ctx || (!ctx.prefix && !ctx.suffix)) {
      return null;
    }

    // Токен отмены VS Code → AbortSignal для LLM-запроса
    const { signal, dispose } = this.createSignal(token);
    try {
      const suggestion = await this.requestCompletion(ctx, signal);
      if (!suggestion || suggestion.trim().length === 0) {
        return null;
      }

      // Кэш: не предлагать то же самое 2 раза подряд
      const uri = document.uri.toString();
      if (this.lastSuggestion === suggestion && this.lastUri === uri) {
        return null;
      }
      this.lastSuggestion = suggestion;
      this.lastUri = uri;

      // Диапазон вставки — от текущей позиции курсора
      const range = new vscode.Range(position, position);
      return new vscode.InlineCompletionList([
        new vscode.InlineCompletionItem(suggestion, range),
      ]);
    } catch {
      return null;
    } finally {
      dispose();
    }
  }

  /**
   * Очистить кэш предложения (при Escape / отключении автокомплита).
   */
  public clearSuggestion(): void {
    this.lastSuggestion = null;
    this.lastUri = null;
  }

  /**
   * Освободить ресурсы.
   */
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.clearSuggestion();
  }

  /** Преобразовать CancellationToken в AbortSignal (+ disposer подписки). */
  private createSignal(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
      controller.abort();
      return { signal: controller.signal, dispose: () => {} };
    }
    const sub = token.onCancellationRequested(() => controller.abort());
    return { signal: controller.signal, dispose: () => sub.dispose() };
  }
}
