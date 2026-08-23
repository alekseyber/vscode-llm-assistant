// E2E: smoke-тест P0 — расширение стартует и открывает чат без падения.
// Не проверяет DOM WebView (его логика покрыта jsdom в test:mocked), только что
// getHtmlForWebview() в реальном Extension Host читает webview-ресурсы и не роняет расширение.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'alekseyber.vscode-llm-assistant';

suite('E2E: P0 WebView smoke', () => {
  test('чат открывается без падения (webview-ресурсы загружены)', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    await ext.activate();

    // Открытие чата триггерит getHtmlForWebview() — чтение index.html + стилей + скриптов.
    // Падение здесь = ошибка чтения webview-ресурса (недостающий файл/путь).
    await vscode.commands.executeCommand('llmAssistant.chat.focus');

    assert.strictEqual(ext.isActive, true, 'расширение активно после открытия чата');
  });
});
