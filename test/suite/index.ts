// Точка входа для mocha — загружает E2E-тестовые наборы (реальный VS Code Extension Host)
// Юнит-тесты (мок vscode) запускаются отдельно через test/run-mocked.js (npm run test:mocked).
// Здесь — только интеграционные тесты, которым нужен настоящий VS Code API.

import * as path from 'path';

// Mocha импортируется через require для совместимости с CJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require('mocha');

/**
 * Список E2E-тестовых модулей (запускаются внутри реального VS Code).
 */
const testModules: string[] = [
  './e2e/activation.e2e',
  './e2e/applyMode.e2e',
  './e2e/askUser.e2e',
  './e2e/allowList.e2e',
  './e2e/planModeSession.e2e',
  './e2e/review.e2e',
  './e2e/p0Webview.e2e',
];

/**
 * Функция, вызываемая VS Code при запуске тестов.
 * Создаёт инстанс mocha с TDD-интерфейсом, загружает тесты и запускает их.
 */
export function run(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const mocha = new Mocha({
        ui: 'tdd',
        timeout: 20000,
        color: true,
        reporter: 'spec',
      });

      for (const mod of testModules) {
        const modulePath = path.resolve(__dirname, mod);
        mocha.addFile(modulePath);
      }

      console.log(`[Тесты] Загружено ${testModules.length} E2E-наборов`);
      console.log(`[Тесты] Наборы: ${testModules.join(', ')}`);

      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`Тесты завершились с ${failures} ошибками`));
        } else {
          console.log('[Тесты] Все E2E-тесты пройдены успешно');
          resolve();
        }
      });
    } catch (err) {
      console.error('[Тесты] Ошибка загрузки тестовых модулей:', err);
      reject(err);
    }
  });
}
