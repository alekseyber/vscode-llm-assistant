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
import { debugLog } from './shared/logger';
import { RunHistoryStore } from './shared/RunHistoryStore';
import { HistoryViewProvider, HISTORY_VIEW_TYPE } from './modes/history/HistoryViewProvider';

/** Глобальный экземпляр менеджера провайдеров */
let providerManager: ProviderManager;

/** Глобальный экземпляр менеджера истории чата */
let conversationManager: ConversationManager;

/** Глобальный экземпляр контроллера Edit Mode */
let editController: EditController;

/** Глобальный экземпляр контроллера Autocomplete (ghost text) */
let autocompleteController: AutocompleteController;

/** Глобальный экземпляр хранилища истории запусков (слой 07 Product Shell) */
let runHistoryStore: RunHistoryStore;

/** Глобальный экземпляр провайдера вкладки «История» */
let historyViewProvider: HistoryViewProvider;

/**
 * Точка входа. Вызывается VS Code при активации расширения.
 * Инициализирует все компоненты, регистрирует провайдеры видов и команды.
 *
 * @param context - контекст расширения (subscriptions, workspaceState, extensionUri)
 */
export function activate(context: vscode.ExtensionContext) {
    try {
    console.log('[LLM Assistant] Активация...');

    // ── 1. Инициализация компонентов ──
    providerManager = new ProviderManager();
    conversationManager = new ConversationManager(context.workspaceState);
    editController = new EditController(providerManager);
    autocompleteController = new AutocompleteController(providerManager);

    // Инициализация хранилища истории запусков (слой 07 Product Shell)
    runHistoryStore = new RunHistoryStore(context.globalState);

    // Регистрация провайдера вкладки «История» (Activity Bar) — ДО ChatViewProvider
    historyViewProvider = new HistoryViewProvider(runHistoryStore);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(HISTORY_VIEW_TYPE, historyViewProvider)
    );

    // ── 2. Регистрация WebView Provider ──
    const chatViewProvider = new ChatViewProvider(context, providerManager, conversationManager, runHistoryStore, historyViewProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );

    // ── 3. Команды ──
    registerCommands({ context, providerManager, conversationManager, editController, autocompleteController, runHistoryStore, historyViewProvider });

    // ── 4. Конфигурация ──
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('llmAssistant')) {
                providerManager.refresh();
            }
        })
    );

    console.log('[LLM Assistant] OK. 4 режима: chat, edit, autocomplete, apply.');
    } catch (err: any) {
        console.error('[LLM Assistant] Ошибка активации:', err.message, err.stack);
        vscode.window.showErrorMessage('LLM Assistant: ошибка загрузки — ' + err.message);
    }
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