// Точка входа для запуска тестов в VS Code Extension Host
// Загружает mocha и запускает все тесты из test/suite/
// Работает через @vscode/test-electron (vscode-test)

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import {
  runTests,
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} from '@vscode/test-electron';

/**
 * Запустить тесты extension во временном VS Code окне.
 * 
 * Процесс:
 * 1. Проверяем, скачан ли VS Code (если нет — downloadAndUnzipVSCode скачает)
 * 2. Запускаем VS Code с extensionDevelopmentPath и extensionTestsPath
 * 3. Ждём завершения тестов
 * 
 * @returns Promise, который резолвится при успешном завершении
 * @throws если тесты упали
 */
async function main(): Promise<void> {
  try {
    console.log('Запуск тестов VS Code LLM Assistant...');

    // Корневая папка проекта
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    
    // Путь к скомпилированным тестам
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Скачиваем VS Code (если ещё не скачан) и запускаем тесты
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    
    // Настройки для запуска VS Code в headless режиме
    // Открываем КОПИЮ фикстуры во временном каталоге, а не корень репозитория:
    // иначе workspace-зависимые тесты пишут в git (или не могут писать вовсе).
    const fixtureSource = path.resolve(extensionDevelopmentPath, 'test/fixtures/e2e-workspace');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-e2e-ws-'));
    fs.cpSync(fixtureSource, workspaceDir, { recursive: true });
    console.log(`E2E workspace (копия фикстуры): ${workspaceDir}`);

    // ВАЖНО: extensionDevelopmentPath передаёт сам runTests (--extensionDevelopmentPath=…).
    // Если продублировать его позиционным аргументом, окно открывает ДВА корня
    // (репозиторий + копия фикстуры), и workspaceFolders[0] указывает на репозиторий —
    // тогда .vscode/llm-assistant.json и .llma/* из фикстуры не читаются вовсе.
    const launchArgs: string[] = [
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-sandbox',
      '--disable-workspace-trust',
      workspaceDir,
    ];

    console.log(`VS Code executable: ${vscodeExecutablePath}`);
    console.log(`Extension path: ${extensionDevelopmentPath}`);
    console.log(`Tests path: ${extensionTestsPath}`);
    console.log(`Launch args: ${launchArgs.join(' ')}`);

    // Запускаем тесты
    const result = await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
    });

    console.log(`Тесты завершены с кодом: ${result}`);
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* временный каталог остался — не повод валить прогон */
    }
    process.exit(result ?? 0);
  } catch (err) {
    console.error('Ошибка запуска тестов:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Запускаем, только если файл выполняется напрямую
if (require.main === module) {
  main().catch((err) => {
    console.error('Критическая ошибка:', err);
    process.exit(1);
  });
}

export { main };