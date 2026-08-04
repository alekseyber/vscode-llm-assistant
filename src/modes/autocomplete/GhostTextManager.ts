// GhostTextManager — управление ghost text (InlineCompletionItemProvider)
// Показывает предложение автокомплита, принимает (Tab) или отклоняет (Escape)
// Кэш: не предлагает то же самое 2 раза подряд

import * as vscode from 'vscode';

/** Запись кэша: URI файла + текст предложения */
interface CacheEntry {
  uri: string;
  suggestion: string;
}

/**
 * GhostTextManager — реализует InlineCompletionItemProvider для VS Code.
 *
 * Отвечает за:
 * - Регистрацию провайдера inline-завершений
 * - Показ ghost text (предложений автокомплита)
 * - Кэш: не дублировать одинаковые предложения
 * - Очистку предложения при изменении документа
 */
export class GhostTextManager implements vscode.InlineCompletionItemProvider {
  /** Текущее предложение */
  private currentSuggestion: string | null = null;
  /** Диапазон, на который рассчитано предложение */
  private currentRange: vscode.Range | null = null;
  /** URI документа, для которого сделано предложение */
  private currentDocumentUri: string | null = null;
  /** Кэш: последнее показанное предложение (URI + текст) */
  private lastCacheEntry: CacheEntry | null = null;
  /** Подписки для очистки */
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Регистрируем себя как провайдер для всех текстовых документов
    const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      this
    );
    this.disposables.push(providerDisposable);

    // Подписываемся на изменение документа, чтобы очищать устаревшие предложения
    const changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (this.currentDocumentUri && e.document.uri.toString() === this.currentDocumentUri) {
        this.clearSuggestion();
      }
    });
    this.disposables.push(changeDisposable);
  }

  /**
   * Реализация InlineCompletionItemProvider.
   * Вызывается VS Code, когда нужно показать inline-завершение.
   * Возвращает текущее предложение, если оно соответствует позиции курсора.
   *
   * @param document - документ, в котором происходит редактирование
   * @param position - позиция курсора
   * @param context - контекст завершения
   * @param token - токен отмены
   * @returns список inline-завершений или null
   */
  public provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlineCompletionList> {
    // Если нет активного предложения — ничего не показываем
    if (!this.currentSuggestion || !this.currentRange) {
      return null;
    }

    // Проверяем, что документ совпадает
    const currentUri = document.uri.toString();
    if (currentUri !== this.currentDocumentUri) {
      return null;
    }

    // Если курсор ушёл из зоны предложения — очищаем и не показываем
    if (!this.currentRange.contains(position)) {
      this.clearSuggestion();
      return null;
    }

    // Создаём InlineCompletionItem
    const item = new vscode.InlineCompletionItem(
      this.currentSuggestion,
      this.currentRange
    );

    return new vscode.InlineCompletionList([item]);
  }

  /**
   * Установить новое предложение автокомплита.
   * Проверяет кэш: если предложение совпадает с предыдущим, не показывает.
   *
   * @param suggestion - текст предложения
   * @param range - диапазон, который будет заменён предложением
   * @param documentUri - URI документа
   * @returns true, если предложение установлено, false — если заблокировано кэшем
   */
  public setSuggestion(suggestion: string, range: vscode.Range, documentUri: string): boolean {
    // Проверяем кэш: не предлагать то же самое 2 раза подряд
    if (
      this.lastCacheEntry &&
      this.lastCacheEntry.uri === documentUri &&
      this.lastCacheEntry.suggestion === suggestion
    ) {
      return false;
    }

    // Сохраняем предложение
    this.currentSuggestion = suggestion;
    this.currentRange = range;
    this.currentDocumentUri = documentUri;
    this.lastCacheEntry = { uri: documentUri, suggestion };

    return true;
  }

  /**
   * Очистить текущее предложение (например, при Escape).
   * VS Code сам скрывает ghost text, но мы также сбрасываем состояние.
   */
  public clearSuggestion(): void {
    this.currentSuggestion = null;
    this.currentRange = null;
    this.currentDocumentUri = null;
    // Не очищаем кэш — он нужен для предотвращения дублирования
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
    this.lastCacheEntry = null;
  }
}