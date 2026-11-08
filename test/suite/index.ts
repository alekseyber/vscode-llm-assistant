// Точка входа для mocha — загружает E2E-тестовые наборы (реальный VS Code Extension Host)
// Юнит-тесты (мок vscode) запускаются отдельно через test/run-mocked.js (npm run test:mocked).
// Здесь — только интеграционные тесты, которым нужен настоящий VS Code API.

import * as fs from 'fs';
import * as path from 'path';

// Mocha импортируется через require для совместимости с CJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require('mocha');

/**
 * E2E-модули собираются из каталога, а не из списка.
 *
 * Раньше здесь лежал захардкоженный массив: новый `*.e2e.ts` молча не запускался,
 * прогон оставался зелёным, и «покрыто e2e» было неправдой (проверено 09.11:
 * тест с заведомо неверным ожиданием проходил, потому что не грузился).
 */
function discoverE2eModules(): string[] {
  const dir = path.resolve(__dirname, 'e2e');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.e2e.js'))
    .sort()
    .map((file) => `./e2e/${file.replace(/\.e2e\.js$/, '.e2e')}`);
}

const testModules: string[] = discoverE2eModules();

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
