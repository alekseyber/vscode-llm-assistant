// ConversationManager — управление историей сообщений чата
// Сохраняет/восстанавливает историю через context.workspaceState (VS Code Memento)
// Позволяет прикреплять контекст кода (текущий файл, выделение)
// Учитывает настройку llmAssistant.chat.maxContextTokens — обрезает историю при превышении

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';

/**
 * Контекст кода, прикреплённый к сообщению.
 * Содержит информацию о файле и выделении.
 */
export interface CodeContext {
  /** Путь к файлу относительно workspace */
  filePath: string;
  /** Содержимое файла или выделенного фрагмента */
  content: string;
  /** Начальная строка выделения (1-indexed) */
  selectionStart?: number;
  /** Конечная строка выделения */
  selectionEnd?: number;
}

/**
 * Сообщение с опциональным контекстом кода.
 */
export interface ContextMessage extends ChatMessage {
  /** Прикреплённый контекст кода (если есть) */
  context?: CodeContext;
}

/**
 * ConversationManager — управляет историей сообщений в чате.
 *
 * Хранит массив сообщений в памяти и периодически сохраняет его
 * в workspaceState (Memento) VS Code. При старте восстанавливает
 * последнюю сессию.
 *
 * Особенности:
 * - Автосохранение после каждого добавленного сообщения
 * - Поддержка контекста кода (выделенный текст, файл целиком)
 * - Ограничение по количеству сообщений (максимум 100)
 */
export class ConversationManager {
  /** Ключ для хранения в workspaceState */
  private static readonly STORAGE_KEY = 'llmAssistant.chat.history';

  /** Максимальное количество сообщений в истории */
  private static readonly MAX_MESSAGES = 100;

  /** Текущая история сообщений */
  private messages: ContextMessage[] = [];

  /** Состояние workspace для сохранения/восстановления */
  private storage: vscode.Memento;

  /**
   * @param storage - workspaceState из ExtensionContext
   */
  constructor(storage: vscode.Memento) {
    this.storage = storage;
    this.load(); // Восстанавливаем историю при создании
  }

  /**
   * Получить все сообщения текущей сессии.
   * @returns копия массива сообщений
   */
  getMessages(): ContextMessage[] {
    return [...this.messages];
  }

  /**
   * Получить историю для отправки в LLM с учётом лимита токенов.
   *
   * Читает настройку llmAssistant.chat.maxContextTokens (по умолчанию 4096)
   * и обрезает историю: при превышении лимита удаляются самые старые
   * сообщения, чтобы запрос уложился в контекстное окно модели.
   * Настройка читается при каждом вызове — изменение применяется сразу.
   *
   * @returns массив сообщений, не превышающий лимит токенов
   */
  getMessagesForRequest(): ContextMessage[] {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const maxTokens = config.get<number>('chat.maxContextTokens', 4096);

    // Идём с конца истории (самые новые сообщения) и набираем до лимита
    const result: ContextMessage[] = [];
    let totalTokens = 0;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      const messageTokens = ConversationManager.estimateTokens(message.content)
        + (message.context?.content
          ? ConversationManager.estimateTokens(message.context.content)
          : 0);

      // Если лимит превышен и хотя бы одно сообщение уже включено — останавливаемся
      if (totalTokens + messageTokens > maxTokens && result.length > 0) {
        break;
      }

      totalTokens += messageTokens;
      result.unshift(message);
    }

    return result;
  }

  /**
   * Приблизительная оценка числа токенов в тексте.
   * Грубая эвристика: ~4 символа на 1 токен (для кода и английского текста).
   *
   * @param text — текст для оценки
   * @returns оценка числа токенов
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Добавить сообщение в историю.
   * Автоматически сохраняет историю после добавления.
   * При превышении лимита удаляет самые старые сообщения.
   *
   * @param message - сообщение для добавления
   */
  addMessage(message: ContextMessage): void {
    this.messages.push(message);

    // Ограничиваем размер истории — удаляем самые старые сообщения
    if (this.messages.length > ConversationManager.MAX_MESSAGES) {
      this.messages = this.messages.slice(-ConversationManager.MAX_MESSAGES);
    }

    this.save();
  }

  /**
   * Очистить историю сообщений.
   * Удаляет все сообщения из памяти и из workspaceState.
   */
  clearHistory(): void {
    this.messages = [];
    this.save();
  }

  /**
   * Прикрепить контекст кода к последнему пользовательскому сообщению.
   * Используется, когда пользователь выделяет код и добавляет его в контекст.
   *
   * @param context - контекст кода (файл, выделение)
   */
  attachCodeContext(context: CodeContext): void {
    // Ищем последнее сообщение от пользователя
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        this.messages[i].context = context;
        break;
      }
    }
    this.save();
  }

  /**
   * Сохранить историю в workspaceState.
   * Вызывается автоматически после каждого изменения.
   */
  private save(): void {
    try {
      this.storage.update(
        ConversationManager.STORAGE_KEY,
        this.messages
      );
    } catch (error) {
      console.error('[ConversationManager] Ошибка сохранения истории:', error);
    }
  }

  /**
   * Восстановить историю из workspaceState.
   * Вызывается в конструкторе.
   */
  private load(): void {
    try {
      const saved = this.storage.get<ContextMessage[]>(
        ConversationManager.STORAGE_KEY,
        []
      );
      this.messages = saved;
    } catch (error) {
      console.error('[ConversationManager] Ошибка загрузки истории:', error);
      this.messages = [];
    }
  }
}