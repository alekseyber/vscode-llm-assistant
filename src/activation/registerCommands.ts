// registerCommands.ts — централизованная регистрация всех команд расширения
// Регистрирует 6 команд в Command Palette с горячими клавишами (keybindings в package.json):
//   1. llmAssistant.chat.focus          (Ctrl+Shift+L) — открыть чат
//   2. llmAssistant.chat.addSelection   — добавить выделение в контекст чата
//   3. llmAssistant.edit.selection      (Ctrl+I)       — редактировать выделенный код
//   4. llmAssistant.autocomplete.toggle — вкл/выкл автокомплит
//   5. llmAssistant.apply.start         (Ctrl+Shift+A) — запустить агентный режим
//   6. llmAssistant.selectProvider      — выбрать провайдера/модель через QuickPick
//
// Связывает все 4 режима (chat, edit, autocomplete, apply) через единый entry point.

import * as vscode from 'vscode';
import { ProviderManager } from '../providers/manager';
import { ChatPanel } from '../modes/chat/ChatPanel';
import { ConversationManager } from '../modes/chat/ConversationManager';
import { EditController } from '../modes/edit/EditController';
import { AutocompleteController } from '../modes/autocomplete/AutocompleteController';
import { AgentController } from '../modes/apply/AgentController';
import { ToolSystem } from '../modes/apply/ToolSystem';
import { createTools } from '../modes/apply/ToolDefinitions';

/**
 * Зависимости, необходимые для регистрации команд.
 * Передаются из extension.ts при активации расширения.
 */
export interface CommandDependencies {
  /** Контекст расширения (subscriptions, workspaceState, extensionUri) */
  context: vscode.ExtensionContext;
  /** Менеджер провайдеров — общий для всех режимов */
  providerManager: ProviderManager;
  /** Менеджер истории чата */
  conversationManager: ConversationManager;
  /** Контроллер Edit Mode */
  editController: EditController;
  /** Контроллер Autocomplete */
  autocompleteController: AutocompleteController;
}

/**
 * Зарегистрировать все 6 команд расширения.
 * Все команды добавляются в context.subscriptions,
 * поэтому VS Code сам освободит их при деактивации.
 *
 * @param deps - зависимости (контекст, менеджеры, контроллеры режимов)
 */
export function registerCommands(deps: CommandDependencies): void {
  const { context, providerManager, conversationManager, editController, autocompleteController } = deps;

  // ── 1. llmAssistant.chat.focus (Ctrl+Shift+L) — открыть/сфокусировать чат ──
  context.subscriptions.push(
    vscode.commands.registerCommand('llmAssistant.chat.focus', () => {
      // Создаём WebviewPanel чата (или показываем существующую)
      ChatPanel.createOrShow(context, providerManager, conversationManager);
    })
  );

  // ── 2. llmAssistant.chat.addSelection — добавить выделение в контекст чата ──
  context.subscriptions.push(
    vscode.commands.registerCommand('llmAssistant.chat.addSelection', () => {
      addSelectionToContext(conversationManager);
    })
  );

  // ── 3. llmAssistant.edit.selection (Ctrl+I) — редактировать выделенный код ──
  context.subscriptions.push(
    vscode.commands.registerCommand('llmAssistant.edit.selection', () => {
      // Запускаем Edit Mode: выделение → QuickPick → LLM → diff → accept/reject
      editController.handleEditSelection();
    })
  );

  // ── 4. llmAssistant.autocomplete.toggle — вкл/выкл автокомплит ──
  context.subscriptions.push(
    vscode.commands.registerCommand('llmAssistant.autocomplete.toggle', () => {
      autocompleteController.toggleAutocomplete();
    })
  );

  // ── 5. llmAssistant.apply.start (Ctrl+Shift+A) — запустить агентный режим ──
  context.subscriptions.push(
    vscode.commands.registerCommand('llmAssistant.apply.start', () => {
      startApplyMode(context, providerManager);
    })
  );

  // ── 6. llmAssistant.selectProvider — QuickPick со списком провайдеров/моделей ──
  context.subscriptions.push(
    vscode.commands.registerCommand('llmAssistant.selectProvider', () => {
      selectProvider(providerManager);
    })
  );

  console.log('[registerCommands] Зарегистрировано 6 команд: chat.focus, chat.addSelection, edit.selection, autocomplete.toggle, apply.start, selectProvider');
}

/**
 * Добавить выделенный код в контекст чата.
 * Собирает информацию о выделении: текст, файл, строки —
 * и прикрепляет её к последнему пользовательскому сообщению через ConversationManager.
 *
 * @param conversationManager - менеджер истории чата
 */
function addSelectionToContext(conversationManager: ConversationManager): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Нет активного редактора');
    return;
  }

  const selection = editor.selection;
  const document = editor.document;

  // Получаем выделенный текст
  const selectedText = document.getText(selection);
  if (!selectedText) {
    vscode.window.showWarningMessage('Ничего не выделено');
    return;
  }

  // Формируем контекст кода
  const codeContext = {
    filePath: document.uri.fsPath,
    content: selectedText,
    selectionStart: selection.start.line + 1, // 1-indexed
    selectionEnd: selection.end.line + 1,
  };

  // Сохраняем контекст в историю
  conversationManager.attachCodeContext(codeContext);

  // Уведомляем пользователя
  const fileName = document.uri.path.split('/').pop() || 'файл';
  vscode.window.showInformationMessage(
    `Добавлено выделение (${selectedText.length} символов) из ${fileName}`
  );
}

/**
 * Показать QuickPick для выбора провайдера и модели.
 * Двухшаговый выбор: сначала провайдер, затем модель.
 * Результат сохраняется в настройки llmAssistant.defaultProvider / defaultModel —
 * все последующие запросы (chat, edit, autocomplete, apply) пойдут через новый провайдер.
 *
 * @param providerManager - менеджер провайдеров
 */
async function selectProvider(providerManager: ProviderManager): Promise<void> {
  const providers = providerManager.getAllProviders();
  const providerNames = Array.from(providers.keys());

  if (providerNames.length === 0) {
    vscode.window.showErrorMessage(
      'Нет настроенных провайдеров. Настройте llmAssistant.providers в settings.json.'
    );
    return;
  }

  // Шаг 1: выбор провайдера
  const selectedProvider = await vscode.window.showQuickPick(providerNames, {
    placeHolder: 'Выберите провайдера',
  });

  if (!selectedProvider) return;

  // Шаг 2: выбор модели (список из конфигурации провайдера)
  const provider = providers.get(selectedProvider);
  if (!provider) return;

  const models = await provider.models();
  const selectedModel = await vscode.window.showQuickPick(models, {
    placeHolder: `Выберите модель для ${selectedProvider}`,
  });

  if (!selectedModel) return;

  // Сохраняем выбор в настройки — применяется ко всем режимам
  const config = vscode.workspace.getConfiguration('llmAssistant');
  await config.update('defaultProvider', selectedProvider, vscode.ConfigurationTarget.Global);
  await config.update('defaultModel', selectedModel, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(
    `Выбран провайдер: ${selectedProvider}, модель: ${selectedModel}`
  );
}

/**
 * Запустить Apply Mode (агентный режим).
 *
 * Flow:
 * 1. Запрашиваем задачу у пользователя (InputBox)
 * 2. Создаём ToolSystem с 5 инструментами (read_file, write_file, patch_file,
 *    search_files, run_terminal) и AgentController (ReAct-цикл)
 * 3. Запускаем агента с прогресс-индикатором и отменой по кнопке
 * 4. Каждый шаг агента логируется в Output Channel "LLM Assistant — Агент"
 * 5. Финальный ответ показываем пользователю
 *
 * @param context - контекст расширения (для Output Channel)
 * @param providerManager - менеджер провайдеров
 */
async function startApplyMode(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager
): Promise<void> {
  // Получаем провайдера по умолчанию
  const provider = providerManager.getDefault();
  if (!provider) {
    vscode.window.showErrorMessage(
      'Провайдер не настроен. Проверьте настройки llmAssistant.providers.'
    );
    return;
  }

  // Запрашиваем задачу у пользователя
  const task = await vscode.window.showInputBox({
    prompt: 'Опишите задачу для агента',
    placeHolder: 'Например: "Создай функцию parseConfig в src/config.ts и добавь тесты"',
    ignoreFocusOut: true,
    validateInput: (value: string): string | null => {
      if (!value || value.trim().length === 0) {
        return 'Введите задачу для агента';
      }
      return null;
    },
  });

  if (!task) {
    return; // Пользователь отменил ввод
  }

  // Получаем модель и лимит шагов из настроек
  const config = vscode.workspace.getConfiguration('llmAssistant');
  const model = config.get<string>('defaultModel') ?? 'gpt-4o';
  const maxIterations = config.get<number>('apply.maxIterations', 20);
  const providerName = config.get<string>('defaultProvider') ?? 'openai';

  // Создаём Output Channel для лога шагов агента (связь с PLAN.md: логирование)
  const outputChannel = vscode.window.createOutputChannel('LLM Assistant — Агент');
  context.subscriptions.push(outputChannel);
  outputChannel.show(true);
  outputChannel.appendLine(`[INFO] Задача: ${task}`);
  outputChannel.appendLine(`[INFO] Провайдер: ${providerName}, модель: ${model}, maxIterations: ${maxIterations}`);

  // Создаём систему инструментов и агента (ReAct-цикл)
  const toolSystem = new ToolSystem();
  toolSystem.registerAll(createTools());
  const agentController = new AgentController(toolSystem);

  // AbortController для отмены агента пользователем
  const abortController = new AbortController();

  try {
    // Запускаем агента с прогресс-индикатором (cancellable)
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LLM Assistant: агент работает...',
        cancellable: true,
      },
      async (_progress, token) => {
        // Кнопка "Отмена" прерывает агента через AbortSignal
        token.onCancellationRequested(() => {
          abortController.abort();
          outputChannel.appendLine('[WARN] Отмена запрошена пользователем');
        });

        return agentController.run({
          provider,
          model,
          task,
          maxIterations,
          signal: abortController.signal,
          // Логируем каждый шаг ReAct-цикла в Output Channel
          onStep: (step) => {
            switch (step.type) {
              case 'tool_call':
                outputChannel.appendLine(`[INFO] Шаг ${step.iteration}: вызов инструмента ${step.tool}(${JSON.stringify(step.args ?? {})})`);
                break;
              case 'tool_result':
                outputChannel.appendLine(`[INFO] Шаг ${step.iteration}: результат ${step.tool}: ${(step.result ?? '').slice(0, 300)}`);
                break;
              case 'answer':
                outputChannel.appendLine(`[INFO] Шаг ${step.iteration}: финальный ответ агента`);
                outputChannel.appendLine(step.message ?? '');
                break;
              case 'error':
                outputChannel.appendLine(`[ERROR] Шаг ${step.iteration}: ${step.message ?? ''}`);
                break;
              case 'info':
              default:
                outputChannel.appendLine(`[INFO] Шаг ${step.iteration}: ${step.message ?? ''}`);
            }
          },
        });
      }
    );

    // Итоговое уведомление пользователю
    if (result.cancelled) {
      vscode.window.showWarningMessage('Агент остановлен пользователем');
    } else if (result.limitExceeded) {
      vscode.window.showWarningMessage(result.answer);
    } else {
      outputChannel.appendLine(`[INFO] Задача завершена за ${result.iterations} шагов`);
      vscode.window.showInformationMessage('Агент завершил задачу. Подробности в Output Channel "LLM Assistant — Агент".');
    }

    // Показываем итог в отдельном сообщении, если это не просто статус
    if (!result.limitExceeded && !result.cancelled && result.answer) {
      outputChannel.appendLine('[INFO] === Финальный ответ ===');
      outputChannel.appendLine(result.answer);
    }
  } catch (error: any) {
    const errorMessage = error?.message || 'Неизвестная ошибка';
    outputChannel.appendLine(`[ERROR] ${errorMessage}`);
    vscode.window.showErrorMessage(`Ошибка агента: ${errorMessage}`);
  }
}
