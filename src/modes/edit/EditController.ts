// EditController — управление Edit Mode (Ctrl+I)
// Выделение кода → QuickPick (ввод инструкции) → LLM запрос → diff view → accept/reject

import * as vscode from 'vscode';
import { ProviderManager } from '../../providers/manager';
import { computeDiff, applyDiffDecorations, clearDiffDecorations, acceptChanges } from './diff';
import { cleanLlmResponse } from '../../shared/cleanLlmResponse';
import { buildThinkingExtraBody } from '../../shared/thinking';

/**
 * EditController — хендлер для редактирования выделенного кода через LLM.
 *
 * Flow:
 * 1. Пользователь выделяет код в редакторе
 * 2. Вызывает команду llmAssistant.edit.selection (Ctrl+I)
 * 3. Появляется QuickPick для ввода инструкции
 * 4. Отправляется запрос к LLM: контекст (выделенный код) + инструкция пользователя
 * 5. LLM возвращает изменённый код
 * 6. Показывается diff через декорации (зелёный/красный)
 * 7. Пользователь может принять (Accept) или отклонить (Reject) изменения
 */
export class EditController {
  /** Менеджер провайдеров для отправки запросов к LLM */
  private providerManager: ProviderManager;

  /** Состояние текущей сессии редактирования */
  private currentSession: EditSession | null = null;

  /** Подписки на команды accept/reject */
  private acceptDisposable: vscode.Disposable | null = null;
  private rejectDisposable: vscode.Disposable | null = null;

  /**
   * @param providerManager - менеджер провайдеров
   */
  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
  }

  /**
   * Обработать выделение: запустить Edit Mode.
   * Вызывается из команды llmAssistant.edit.selection.
   */
  public async handleEditSelection(): Promise<void> {
    // Получаем активный редактор
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Нет активного редактора');
      return;
    }

    // Проверяем, что есть выделение
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('Сначала выделите код для редактирования');
      return;
    }

    // Получаем выделенный текст
    const selectedText = editor.document.getText(selection);
    if (!selectedText || selectedText.trim().length === 0) {
      vscode.window.showWarningMessage('Выделенный текст пуст');
      return;
    }

    // Запрашиваем инструкцию у пользователя через QuickPick
    const instruction = await this.promptForInstruction();
    if (!instruction) {
      return; // Пользователь отменил
    }

    // Отправляем запрос к LLM
    const newCode = await this.sendEditRequest(selectedText, instruction, editor);
    if (!newCode) {
      return; // Ошибка или отмена
    }

    // Показываем diff
    this.showDiff(editor, selection, selectedText, newCode);
  }

  /**
   * Показать QuickPick для ввода инструкции редактирования.
   *
   * @returns инструкция пользователя или null, если отменено
   */
  private async promptForInstruction(): Promise<string | null> {
    const input = await vscode.window.showInputBox({
      prompt: 'Опишите, как изменить выделенный код',
      placeHolder: 'Например: "добавить типы", "переписать на async/await", "добавить обработку ошибок"',
      validateInput: (value: string): string | null => {
        if (!value || value.trim().length === 0) {
          return 'Введите инструкцию для изменения кода';
        }
        return null;
      },
      ignoreFocusOut: true,
    });

    return input ?? null;
  }

  /**
   * Отправить запрос к LLM: выделенный код + инструкция.
   *
   * @param selectedText - выделенный текст
   * @param instruction - инструкция пользователя
   * @param editor - активный редактор (для контекста)
   * @returns новый код от LLM или null при ошибке
   */
  private async sendEditRequest(
    selectedText: string,
    instruction: string,
    editor: vscode.TextEditor
  ): Promise<string | null> {
    // Получаем провайдера по умолчанию
    const provider = this.providerManager.getDefault();
    if (!provider) {
      vscode.window.showErrorMessage(
        'Провайдер не настроен. Проверьте настройки llmAssistant.providers.'
      );
      return null;
    }

    // Получаем модель по умолчанию
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = config.get<string>('defaultModel') ?? 'gpt-4o';

    // Определяем язык файла для подсказки LLM
    const fileExtension = editor.document.fileName.split('.').pop() || '';
    const languageId = editor.document.languageId;

    // Формируем промпт для LLM
    const systemPrompt = `Ты — ассистент для редактирования кода в VS Code.
Пользователь выделил код и дал инструкцию по его изменению.

Файл: ${editor.document.fileName}
Язык: ${languageId}

Инструкция пользователя: ${instruction}

Верни ТОЛЬКО изменённый код, без пояснений, без разметки.
Код должен быть полностью рабочим и заменять выделенный фрагмент целиком.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Вот выделенный код:\n\`\`\`${fileExtension}\n${selectedText}\n\`\`\`\n\nИзмени его согласно инструкции: ${instruction}` },
    ];

    try {
      // Создаём AbortController для возможности отмены
      const abortController = new AbortController();

      // Показываем прогресс
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'LLM Assistant: Редактирование кода...',
          cancellable: true,
        },
        async (progress, token) => {
          // Если пользователь нажал Cancel — прерываем запрос
          token.onCancellationRequested(() => {
            abortController.abort();
          });

          const stream = provider.chat(
            messages,
            { model, stream: true, extraBody: buildThinkingExtraBody(model) },
            abortController.signal
          );

          let fullResponse = '';
          for await (const chunk of stream) {
            fullResponse += chunk;
          }

          return fullResponse;
        }
      );

      // Очищаем ответ от лишних обрамлений (```code```)
      return cleanLlmResponse(result);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        vscode.window.showInformationMessage('Редактирование отменено');
        return null;
      }

      const errorMessage = error.message || 'Неизвестная ошибка';
      vscode.window.showErrorMessage(`Ошибка при запросе к LLM: ${errorMessage}`);
      console.error('[EditController] Ошибка:', error);
      return null;
    }
  }

  /**
   * Показать diff между старым и новым кодом.
   *
   * Использует декорации (зелёный для добавленного, красный для удалённого)
   * и регистрирует временные команды accept/reject.
   *
   * @param editor - активный редактор
   * @param selection - исходное выделение
   * @param oldText - старый текст (выделенный код)
   * @param newText - новый текст (ответ LLM)
   */
  private showDiff(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    oldText: string,
    newText: string
  ): void {
    // Если текст не изменился — уведомляем и выходим
    if (oldText === newText) {
      vscode.window.showInformationMessage('Код не изменился. Попробуйте другую инструкцию.');
      return;
    }

    // Вычисляем diff
    const diffResult = computeDiff(oldText, newText);

    // Сохраняем сессию
    this.currentSession = {
      editor,
      selection,
      oldText,
      newText,
      diffResult,
    };

    // Применяем декорации
    applyDiffDecorations(editor, diffResult, selection.start.line);

    // Регистрируем команды accept/reject
    this.registerAcceptRejectCommands();

    // Показываем уведомление с кнопками Accept / Reject
    vscode.window.showInformationMessage(
      `Изменений: +${diffResult.addedCount} / -${diffResult.removedCount}. Принять или отклонить?`,
      'Принять (Accept)',
      'Отклонить (Reject)'
    ).then((action) => {
      if (action === 'Принять (Accept)') {
        this.handleAccept();
      } else if (action === 'Отклонить (Reject)') {
        this.handleReject();
      }
    });

    // Также показываем статус-бар с кнопками
    this.showStatusBarActions();
  }

  /**
   * Показать элементы в статус-баре для accept/reject.
   */
  private showStatusBarActions(): void {
    if (!this.currentSession) return;

    // Создаём статус-бар элементы
    const statusBarAccept = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    statusBarAccept.text = '$(check) Принять';
    statusBarAccept.tooltip = 'Принять изменения (Accept)';
    statusBarAccept.command = 'llmAssistant.edit.accept';
    statusBarAccept.show();

    const statusBarReject = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    statusBarReject.text = '$(x) Отклонить';
    statusBarReject.tooltip = 'Отклонить изменения (Reject)';
    statusBarReject.command = 'llmAssistant.edit.reject';
    statusBarReject.show();

    // Сохраняем в сессии для очистки
    this.currentSession.statusBarItems = [statusBarAccept, statusBarReject];
  }

  /**
   * Зарегистрировать временные команды accept/reject.
   * Команды живут только пока активна сессия редактирования.
   */
  private registerAcceptRejectCommands(): void {
    // Очищаем предыдущие команды
    this.disposeAcceptRejectCommands();

    // Регистрируем команду Accept
    this.acceptDisposable = vscode.commands.registerCommand(
      'llmAssistant.edit.accept',
      () => this.handleAccept()
    );

    // Регистрируем команду Reject
    this.rejectDisposable = vscode.commands.registerCommand(
      'llmAssistant.edit.reject',
      () => this.handleReject()
    );
  }

  /**
   * Обработать Accept — применить изменения.
   */
  private async handleAccept(): Promise<void> {
    if (!this.currentSession) return;

    const { editor, selection, newText } = this.currentSession;

    try {
      // Применяем изменения через TextEditor.edit()
      const success = await acceptChanges(editor, newText, selection);

      if (success) {
        // Очищаем декорации
        clearDiffDecorations(editor);

        // Показываем сообщение об успехе
        vscode.window.showInformationMessage('Изменения приняты');

        // Сохраняем файл (опционально)
        await editor.document.save();
      } else {
        vscode.window.showErrorMessage('Не удалось применить изменения');
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Ошибка при применении изменений: ${error.message}`);
      console.error('[EditController] Ошибка Accept:', error);
    } finally {
      // Очищаем сессию
      this.cleanupSession();
    }
  }

  /**
   * Обработать Reject — отклонить изменения.
   */
  private handleReject(): void {
    if (!this.currentSession) return;

    const { editor } = this.currentSession;

    // Просто очищаем декорации
    clearDiffDecorations(editor);

    // Показываем сообщение
    vscode.window.showInformationMessage('Изменения отклонены');

    // Очищаем сессию
    this.cleanupSession();
  }

  /**
   * Очистить ресурсы сессии редактирования.
   */
  private cleanupSession(): void {
    // Очищаем статус-бар
    if (this.currentSession?.statusBarItems) {
      for (const item of this.currentSession.statusBarItems) {
        item.dispose();
      }
    }

    // Очищаем команды
    this.disposeAcceptRejectCommands();

    // Сбрасываем сессию
    this.currentSession = null;
  }

  /**
   * Удалить временные команды accept/reject.
   */
  private disposeAcceptRejectCommands(): void {
    if (this.acceptDisposable) {
      this.acceptDisposable.dispose();
      this.acceptDisposable = null;
    }
    if (this.rejectDisposable) {
      this.rejectDisposable.dispose();
      this.rejectDisposable = null;
    }
  }

  /**
   * Освободить все ресурсы при деактивации.
   */
  public dispose(): void {
    this.cleanupSession();
  }
}

/**
 * Состояние сессии редактирования.
 * Хранит ссылки на редактор, выделение, старый/новый текст и результат diff.
 */
interface EditSession {
  /** Активный редактор */
  editor: vscode.TextEditor;
  /** Исходное выделение */
  selection: vscode.Selection;
  /** Старый текст (выделенный код) */
  oldText: string;
  /** Новый текст (ответ LLM) */
  newText: string;
  /** Результат сравнения */
  diffResult: ReturnType<typeof computeDiff>;
  /** Элементы статус-бара для accept/reject (опционально) */
  statusBarItems?: vscode.StatusBarItem[];
}