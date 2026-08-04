// Точка входа в extension
// Регистрирует все компоненты: провайдеры, режимы, команды
// Команды регистрируются централизованно через registerCommands()

import * as vscode from 'vscode';
import { ProviderManager } from './providers/manager';
import { ChatViewProvider } from './modes/chat/ChatViewProvider';
import { ConversationManager } from './modes/chat/ConversationManager';
import { EditController } from './modes/edit/EditController';
import { AutocompleteController } from './modes/autocomplete/AutocompleteController';
import { registerCommands } from './activation/registerCommands';

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
 * Инициализирует все компоненты, регистрирует провайдеры видов и команды.
 *
 * @param context - контекст расширения (subscriptions, workspaceState, extensionUri)
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('[LLM Assistant] Активация...');

    // ── 1. Инициализация компонентов ──

    // Менеджер провайдеров (читает настройки из settings.json)
    providerManager = new ProviderManager();

    // Менеджер истории чата (сохраняется в workspaceState VS Code)
    conversationManager = new ConversationManager(context.workspaceState);

    // Контроллер Edit Mode (Ctrl+I — редактирование выделенного кода)
    editController = new EditController(providerManager);

    // Контроллер Autocomplete (ghost text при паузе в печати)
    autocompleteController = new AutocompleteController(providerManager);

    // ── 2. Регистрация WebView Provider для боковой панели чата ──
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

    // ── 3. Централизованная регистрация всех 6 команд ──
    registerCommands({
        context,
        providerManager,
        conversationManager,
        editController,
        autocompleteController,
    });

    // ── 4. Подписка на изменение конфигурации ──
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('llmAssistant')) {
                providerManager.refresh();
                console.log('[LLM Assistant] Конфигурация обновлена');
            }
        })
    );

    console.log('[LLM Assistant] Активация завершена. Все 4 режима подключены: chat, edit, autocomplete, apply.');
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