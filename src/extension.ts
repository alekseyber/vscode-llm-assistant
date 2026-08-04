// Точка входа в extension
// Регистрирует все компоненты: провайдеры, режимы, команды

import * as vscode from 'vscode';
import { ProviderManager } from './providers/manager';
import { ChatViewProvider } from './modes/chat/ChatViewProvider';
import { ChatPanel } from './modes/chat/ChatPanel';
import { ConversationManager } from './modes/chat/ConversationManager';
import { EditController } from './modes/edit/EditController';
import { AutocompleteController } from './modes/autocomplete/AutocompleteController';

/** Глобальный экземпляр менеджера провайдеров */
let providerManager: ProviderManager;

/** Глобальный экземпляр менеджера истории чата */
let conversationManager: ConversationManager;

/** Глобальный экземпляр контроллера Edit Mode */
let editController: EditController;

/** Глобальный экземпляр контроллера Autocomplete (ghost text) */
let autocompleteController: AutocompleteController;

/**
 * Точка входа. Вызывается VS Code при активации расширения.
 * Регистрирует все компоненты и подписывается на события.
 *
 * @param context - контекст расширения (subscriptions, workspaceState, extensionUri)
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('[LLM Assistant] Активация...');

    // Инициализируем менеджер провайдеров
    providerManager = new ProviderManager();

    // Инициализируем менеджер истории чата (сохраняется в workspaceState)
    conversationManager = new ConversationManager(context.workspaceState);

    // Инициализируем контроллер Edit Mode
    editController = new EditController(providerManager);

    // Инициализируем контроллер Autocomplete (ghost text при паузе в печати)
    autocompleteController = new AutocompleteController(providerManager);

    // Регистрируем WebviewViewProvider для боковой панели чата
    const chatViewProvider = new ChatViewProvider(
        context,
        providerManager,
        conversationManager
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatViewProvider
        )
    );

    // Регистрируем команду: открыть/сфокусировать чат
    context.subscriptions.push(
        vscode.commands.registerCommand('llmAssistant.chat.focus', () => {
            ChatPanel.createOrShow(context, providerManager, conversationManager);
        })
    );

    // Регистрируем команду: редактировать выделенный код (Ctrl+I)
    context.subscriptions.push(
        vscode.commands.registerCommand('llmAssistant.edit.selection', () => {
            editController.handleEditSelection();
        })
    );

    // Регистрируем команду: добавить выделение в контекст чата
    context.subscriptions.push(
        vscode.commands.registerCommand('llmAssistant.chat.addSelection', () => {
            addSelectionToContext();
        })
    );

    // Регистрируем команду: выбрать провайдер
    context.subscriptions.push(
        vscode.commands.registerCommand('llmAssistant.selectProvider', () => {
            selectProvider();
        })
    );

    // Подписываемся на изменение конфигурации для обновления провайдеров
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('llmAssistant')) {
                providerManager.refresh();
                console.log('[LLM Assistant] Конфигурация обновлена');
            }
        })
    );

    console.log('[LLM Assistant] Активация завершена');
}

/**
 * Деактивация расширения (освобождение ресурсов).
 */
export function deactivate() {
    console.log('[LLM Assistant] Деактивация');
    // Освобождаем ресурсы EditController
    if (editController) {
        editController.dispose();
    }

    // Освобождаем ресурсы AutocompleteController
    if (autocompleteController) {
        autocompleteController.dispose();
    }
}

/**
 * Добавить выделенный код в контекст чата.
 * Собирает информацию о выделении: текст, файл, строки.
 */
function addSelectionToContext() {
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
    const context = {
        filePath: document.uri.fsPath,
        content: selectedText,
        selectionStart: selection.start.line + 1, // 1-indexed
        selectionEnd: selection.end.line + 1,
    };

    // Сохраняем контекст в историю
    conversationManager.attachCodeContext(context);

    // Уведомляем пользователя
    const fileName = document.uri.path.split('/').pop() || 'файл';
    vscode.window.showInformationMessage(
        `Добавлено выделение (${selectedText.length} символов) из ${fileName}`
    );
}

/**
 * Показать QuickPick для выбора провайдера и модели.
 */
async function selectProvider() {
    const providers = providerManager.getAllProviders();
    const providerNames = Array.from(providers.keys());

    if (providerNames.length === 0) {
        vscode.window.showErrorMessage(
            'Нет настроенных провайдеров. Настройте llmAssistant.providers в settings.json.'
        );
        return;
    }

    // Выбор провайдера
    const selectedProvider = await vscode.window.showQuickPick(providerNames, {
        placeHolder: 'Выберите провайдера',
    });

    if (!selectedProvider) return;

    // Выбор модели
    const provider = providers.get(selectedProvider);
    if (!provider) return;

    const models = await provider.models();
    const selectedModel = await vscode.window.showQuickPick(models, {
        placeHolder: `Выберите модель для ${selectedProvider}`,
    });

    if (!selectedModel) return;

    // Сохраняем выбор в настройки
    const config = vscode.workspace.getConfiguration('llmAssistant');
    await config.update('defaultProvider', selectedProvider, vscode.ConfigurationTarget.Global);
    await config.update('defaultModel', selectedModel, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(
        `Выбран провайдер: ${selectedProvider}, модель: ${selectedModel}`
    );
}