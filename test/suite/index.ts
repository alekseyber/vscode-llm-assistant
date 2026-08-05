// Точка входа для mocha — загружает все тестовые наборы
// Настраивает mocha с TDD-интерфейсом и импортирует все test suite'ы

import * as path from 'path';

// Mocha импортируется через require для совместимости с CJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require('mocha');

/**
 * Этот файл — точка входа для mocha-тестов, запускаемых внутри VS Code Extension Host.
 * VS Code загружает этот файл через --extensionTestsPath и вызывает экспортированную функцию run().
 * 
 * Все тесты должны быть импортированы здесь, чтобы mocha их зарегистрировала.
 * Мы явно создаём инстанс Mocha с ui: 'tdd', потому что VS Code Extension Host
 * по умолчанию использует BDD (describe/it), а тесты написаны в TDD (suite/test).
 */

// Список тестовых модулей
const testModules: string[] = [
  './providers.test',
  './streaming.test',
  './tools.test',
  './context.test',
  './conversation.test',
  './session.test',
  './agentsMd.test',
  './agentsMdIntegration.test',
  './contextSummarizer.test',
  './summaryIntegration.test',
  './retryHandler.test',
  './toolAllowList.test',
  './mcpClient.test',
  './runHistoryStore.test',
];

/**
 * Функция, вызываемая VS Code при запуске тестов.
 * Создаёт инстанс mocha с TDD-интерфейсом, загружает тесты и запускает их.
 */
export function run(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // Создаём инстанс mocha с TDD-интерфейсом (suite/test/setup/teardown)
      const mocha = new Mocha({
        ui: 'tdd',
        timeout: 10000,
        color: true,
        reporter: 'spec',
      });

      // Загружаем тестовые модули
      for (const mod of testModules) {
        const modulePath = path.resolve(__dirname, mod);
        // Добавляем файл в mocha (он загрузит и зарегистрирует suite/test)
        mocha.addFile(modulePath);
      }

      console.log(`[Тесты] Загружено ${testModules.length} тестовых наборов`);
      console.log(`[Тесты] Наборы: ${testModules.join(', ')}`);

      // Запускаем mocha
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`Тесты завершились с ${failures} ошибками`));
        } else {
          console.log('[Тесты] Все тесты пройдены успешно');
          resolve();
        }
      });
    } catch (err) {
      console.error('[Тесты] Ошибка загрузки тестовых модулей:', err);
      reject(err);
    }
  });
}
