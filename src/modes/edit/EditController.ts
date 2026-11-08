// EditController — управление Edit Mode (Ctrl+Alt+I)
// Выделение кода → QuickPick (ввод инструкции) → LLM запрос → diff view → accept/reject

import * as vscode from 'vscode';
import { ProviderManager } from '../../providers/manager';
import { computeDiff, applyDiffDecorations, clearDiffDecorations, acceptChanges } from './diff';
import { cleanLlmResponse } from '../../shared/cleanLlmResponse';
import { buildThinkingExtraBody } from '../../shared/thinking';
import { RunHistoryStore, RunEntry, generateRunId } from '../../shared/RunHistoryStore';
import { buildProposalPreview } from './proposalPreview';
import { ProposalContentProvider, PROPOSAL_SCHEME } from './ProposalContentProvider';
import { calculateCost } from '../../providers/types';

/**
 * EditController — хендлер для редактирования выделенного кода через LLM.
 *
 * Flow:
 * 1. Пользователь выделяет код в редакторе
 * 2. Вызывает команду llmAssistant.edit.selection (Ctrl+Alt+I)
 * 3. Появляется QuickPick для ввода инструкции
 * 4. Отправляется запрос к LLM: контекст (выделенный код) + инструкция пользователя
 * 5. LLM возвращает изменённый код
 * 6. Показывается diff через декорации (зелёный/красный)
 * 7. Пользователь может принять (Accept) или отклонить (Reject) изменения
 */
export class EditController {
  /** Менеджер провайдеров для отправки запросов к LLM */
  private providerManager: ProviderManager;

  /** Хранилище истории запусков (опционально: пишем и Edit-прогоны, чтобы сводка была полной) */
  private runHistoryStore?: RunHistoryStore;

  /** Состояние текущей сессии редактирования */
  private currentSession: EditSession | null = null;

  /** Подписки на команды accept/reject */
  private acceptDisposable: vscode.Disposable | null = null;
  private rejectDisposable: vscode.Disposable | null = null;

  /** CodeLens с кнопками «Принять / Отклонить» над предлагаемой правкой */
  private codeLensDisposable: vscode.Disposable | null = null;
  private codeLensEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

  /** Виртуальные документы для diff-предпросмотра */
  private proposalProvider: ProposalContentProvider | null = null;
  private proposalRegistration: vscode.Disposable | null = null;

  /**
   * @param providerManager - менеджер провайдеров
   */
  constructor(providerManager: ProviderManager, runHistoryStore?: RunHistoryStore) {
    this.providerManager = providerManager;
    this.runHistoryStore = runHistoryStore;
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
    const startedAt = Date.now();
    const newCode = await this.sendEditRequest(selectedText, instruction, editor);
    if (!newCode) {
      return; // Ошибка или отмена
    }

    // Пишем Edit-прогон в историю: без этого сводка по стоимости неполная (P13)
    this.recordRun(selectedText, newCode, instruction, startedAt);

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
   * Записать Edit-прогон в историю запусков.
   *
   * Токены оцениваются как длина/4 — провайдер в стриминге не отдаёт usage,
   * а та же оценка используется в чате, поэтому цифры сопоставимы.
   */
  private recordRun(oldText: string, newText: string, instruction: string, startedAt: number): void {
    if (!this.runHistoryStore) return;
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = config.get<string>('defaultModel') ?? 'gpt-4o';
    const providerName = config.get<string>('defaultProvider') ?? 'openai';
    const tokensIn = Math.ceil((oldText.length + instruction.length) / 4);
    const tokensOut = Math.ceil(newText.length / 4);
    const entry: RunEntry = {
      id: generateRunId(),
      timestamp: startedAt,
      mode: 'edit',
      task: instruction.slice(0, 100),
      provider: providerName,
      model,
      steps: 1,
      tokensIn,
      tokensOut,
      cost: calculateCost(model, tokensIn, tokensOut),
      duration: Date.now() - startedAt,
      status: 'success',
    };
    this.runHistoryStore.recordRun(entry);
  }

  /**
   * Показать предлагаемую правку в родном diff-редакторе VS Code.
   *
   * Слева — файл как есть, справа — файл с заменённым выделением. Это единственный способ
   * увидеть сам новый код: декорации в исходном файле показывают только места вставки.
   *
   * @returns true, если предпросмотр открыт
   */
  public async showProposalDiff(editor: vscode.TextEditor, selection: vscode.Selection, newText: string): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    if (config.get<boolean>('edit.showProposalDiff') === false) return false;

    const document = editor.document;
    const preview = buildProposalPreview(
      document.getText(),
      document.offsetAt(selection.start),
      document.offsetAt(selection.end),
      newText,
    );

    if (!this.proposalProvider) this.proposalProvider = new ProposalContentProvider();
    if (!this.proposalRegistration) this.proposalRegistration = this.proposalProvider.register();

    const fileName = document.fileName || document.uri.path || 'code.txt';
    const dot = fileName.lastIndexOf('.');
    const ext = dot >= 0 ? fileName.slice(dot) : '.txt';
    const base = `${PROPOSAL_SCHEME}:/preview/${Date.now()}`;
    const beforeUri = vscode.Uri.parse(`${base}-before${ext}`);
    const afterUri = vscode.Uri.parse(`${base}-after${ext}`);

    this.proposalProvider.set(beforeUri, preview.before);
    this.proposalProvider.set(afterUri, preview.after);

    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        beforeUri,
        afterUri,
        `LLM Assistant: предлагаемая правка — ${fileName.split(/[\\/]/).pop()}`,
        // Соседняя колонка + без перехвата фокуса: иначе diff открывается на месте
        // исходного редактора, тот закрывается и Accept падает с
        // «TextEditor#edit not possible on closed editors»
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Найти живой редактор для документа сессии.
   *
   * `TextEditor` протухает, когда его вкладку закрывают, — обращения к нему падают
   * с «TextEditor#edit not possible on closed editors».
   */
  public resolveLiveEditor(editor: vscode.TextEditor): vscode.TextEditor | undefined {
    const document = editor.document;
    if (document && !document.isClosed) {
      const open = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === document.uri.toString(),
      );
      if (open) return open;
      return editor;
    }
    const byUri = vscode.window.visibleTextEditors.find(
      (e) => document && e.document.uri.toString() === document.uri.toString(),
    );
    return byUri;
  }

  /**
   * Закрыть окно diff-предпросмотра и освободить виртуальные документы.
   *
   * Без этого после «Отклонить» окно остаётся висеть, а после «Принять» —
   * показывает уже неактуальное предложение.
   */
  public async closeProposalDiff(): Promise<void> {
    const closedUris: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input: any = tab.input;
        const uri: vscode.Uri | undefined = input && input.uri ? input.uri : undefined;
        if (uri && uri.scheme === PROPOSAL_SCHEME) {
          closedUris.push(uri.toString());
          try {
            await vscode.window.tabGroups.close(tab);
          } catch {
            // вкладку уже закрыли — не мешает
          }
        }
      }
    }
    if (this.proposalProvider) {
      for (const raw of closedUris) {
        this.proposalProvider.delete(vscode.Uri.parse(raw));
      }
    }
  }

  /**
   * Текст уведомления о предлагаемой правке.
   *
   * Содержит диапазон заменяемых строк и первую непустую строку нового кода:
   * без неё по одним «+N / −M» невозможно понять, что предлагается.
   */
  public buildProposalMessage(
    selection: { start: { line: number }; end: { line: number } },
    addedCount: number,
    removedCount: number,
    newText: string,
  ): string {
    const preview = (newText.split('\n').find((l) => l.trim().length > 0) || '').trim().slice(0, 80);
    const range = `Строки ${selection.start.line + 1}–${selection.end.line + 1}`;
    const counts = `+${addedCount} / −${removedCount}`;
    return preview
      ? `${range}: ${counts}. Будет: ${preview}. Принять?`
      : `${range}: ${counts}. Принять?`;
  }

  /**
   * Данные для CodeLens над предлагаемой правкой.
   *
   * Нужны, чтобы пользователь видел кнопки прямо у кода, а не только в уведомлении
   * внизу справа: при частичном выделении зелёные строки визуально совпадают с тем,
   * что уже есть в файле, и без подписи непонятно, что именно предлагается.
   */
  public getProposalLenses(): Array<{ line: number; title: string; command: string }> {
    if (!this.currentSession) return [];
    const line = this.currentSession.selection.start.line;
    const added = this.currentSession.diffResult.addedCount;
    const removed = this.currentSession.diffResult.removedCount;
    return [
      { line, title: `✓ Принять правку (+${added} / −${removed})`, command: 'llmAssistant.edit.accept' },
      { line, title: '✕ Отклонить', command: 'llmAssistant.edit.reject' },
      { line, title: 'Ⓘ Что изменится: заменяются выделенные строки, остальное не трогается', command: '' },
    ];
  }

  /** Зарегистрировать CodeLens-провайдер для документа с активной правкой. */
  private registerProposalCodeLens(editor: vscode.TextEditor): void {
    this.disposeProposalCodeLens();
    const targetUri = editor.document.uri.toString();
    this.codeLensDisposable = vscode.languages.registerCodeLensProvider(
      { scheme: editor.document.uri.scheme },
      {
        onDidChangeCodeLenses: this.codeLensEmitter.event,
        provideCodeLenses: (document: vscode.TextDocument) => {
          if (document.uri.toString() !== targetUri) return [];
          return this.getProposalLenses()
            .filter((l) => l.command)
            .map((l) => new vscode.CodeLens(new vscode.Range(l.line, 0, l.line, 0), {
              title: l.title,
              command: l.command,
            }));
        },
      },
    );
    this.codeLensEmitter.fire();
  }

  /** Снять CodeLens (после accept/reject или новой правки). */
  private disposeProposalCodeLens(): void {
    if (this.codeLensDisposable) {
      this.codeLensDisposable.dispose();
      this.codeLensDisposable = null;
    }
    this.codeLensEmitter.fire();
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

    // Кнопки прямо у кода: без них при частичном выделении непонятно, что предлагается
    this.registerProposalCodeLens(editor);

    // Главное: показать сам результат правки в diff-редакторе (слева «до», справа «после»)
    void this.showProposalDiff(editor, selection, newText);

    // Показываем уведомление с кнопками Accept / Reject
    vscode.window.showInformationMessage(
      this.buildProposalMessage(selection, diffResult.addedCount, diffResult.removedCount, newText),
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
    this.disposeProposalCodeLens();
    if (!this.currentSession) return;

    const { selection, newText } = this.currentSession;
    // Открытие diff могло закрыть исходный редактор — тогда берём живой по тому же документу
    const editor = this.resolveLiveEditor(this.currentSession.editor);

    try {
      if (!editor) {
        vscode.window.showErrorMessage('Редактор с файлом закрыт — правка не применена');
        return;
      }

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
      await this.closeProposalDiff();
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
    this.disposeProposalCodeLens();
    if (!this.currentSession) return;

    const editor = this.resolveLiveEditor(this.currentSession.editor);

    // Просто очищаем декорации
    if (editor) clearDiffDecorations(editor);
    void this.closeProposalDiff();

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