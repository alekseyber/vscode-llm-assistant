// ContextBuilder — сбор контекста для автокомплита
// Формирует структуру AutocompleteContext: текст до/после курсора, путь файла, язык
// Ограничивает размер префикса и суффикса по токенам

import * as vscode from 'vscode';

/** Контекст для запроса автокомплита */
export interface AutocompleteContext {
  /** Путь к файлу */
  filePath: string;
  /** Язык файла */
  languageId: string;
  /** Текст до курсора (ограничен токенами) */
  prefix: string;
  /** Текст после курсора (ограничен токенами) */
  suffix: string;
  /** Позиция курсора в документе */
  cursorLine: number;
  cursorCharacter: number;
}

/**
 * ContextBuilder — собирает контекст из активного редактора.
 *
 * Алгоритм:
 * 1. Берёт текст до курсора (начиная с начала файла, но не более 200 строк)
 * 2. Берёт текст после курсора (не более 50 строк)
 * 3. Ограничивает по токенам: префикс ~1500 токенов, суффикс ~500 токенов
 * 4. Отдаёт структуру AutocompleteContext
 */
export class ContextBuilder {
  /** Максимум строк до курсора */
  private static readonly MAX_PREFIX_LINES = 200;
  /** Максимум строк после курсора */
  private static readonly MAX_SUFFIX_LINES = 50;
  /** Максимум токенов для префикса (грубая оценка: 1 токен ~ 4 символа) */
  private static readonly MAX_PREFIX_TOKENS = 1500;
  /** Максимум токенов для суффикса */
  private static readonly MAX_SUFFIX_TOKENS = 500;

  /**
   * Собрать контекст из активного редактора.
   *
   * @param editor - активный текстовый редактор
   * @returns AutocompleteContext или null, если редактор недоступен
   */
  public build(editor: vscode.TextEditor): AutocompleteContext | null {
    const document = editor.document;
    const position = editor.selection.active;

    // Получаем текст до курсора
    const prefixStartLine = Math.max(0, position.line - ContextBuilder.MAX_PREFIX_LINES);
    const prefixRange = new vscode.Range(
      prefixStartLine,
      0,
      position.line,
      position.character
    );
    let prefix = document.getText(prefixRange);

    // Получаем текст после курсора
    const suffixEndLine = Math.min(
      document.lineCount - 1,
      position.line + ContextBuilder.MAX_SUFFIX_LINES
    );
    const suffixRange = new vscode.Range(
      position.line,
      position.character,
      suffixEndLine,
      document.lineAt(suffixEndLine).text.length
    );
    let suffix = document.getText(suffixRange);

    // Ограничиваем по токенам (эвристика: 1 токен ~ 4 символа)
    prefix = this.truncateToTokens(prefix, ContextBuilder.MAX_PREFIX_TOKENS, 'prefix');
    suffix = this.truncateToTokens(suffix, ContextBuilder.MAX_SUFFIX_TOKENS, 'suffix');

    return {
      filePath: document.uri.fsPath,
      languageId: document.languageId,
      prefix,
      suffix,
      cursorLine: position.line,
      cursorCharacter: position.character,
    };
  }

  /**
   * Грубая оценка количества токенов в тексте.
   * Для английского кода ~4 символа на токен, для русского ~2.
   * Используем консервативную оценку: 3.5 символа на токен.
   *
   * @param text - текст для оценки
   * @returns примерное количество токенов
   */
  public estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Обрезать текст до заданного количества токенов.
   * Для префикса: удаляем строки с начала (оставляем ближайшие к курсору).
   * Для суффикса: удаляем строки с конца (оставляем ближайшие к курсору).
   *
   * @param text - исходный текст
   * @param maxTokens - максимальное количество токенов
   * @param type - тип контекста ('prefix' или 'suffix')
   * @returns обрезанный текст
   */
  private truncateToTokens(text: string, maxTokens: number, type: 'prefix' | 'suffix'): string {
    const lines = text.split('\n');

    if (type === 'prefix') {
      // Для префикса: удаляем строки с начала, пока не влезем в лимит
      let result = lines.join('\n');
      while (this.estimateTokens(result) > maxTokens && lines.length > 0) {
        lines.shift();
        result = lines.join('\n');
      }
      return result;
    } else {
      // Для суффикса: удаляем строки с конца
      let result = lines.join('\n');
      while (this.estimateTokens(result) > maxTokens && lines.length > 0) {
        lines.pop();
        result = lines.join('\n');
      }
      return result;
    }
  }
}