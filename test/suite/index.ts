// Точка входа для mocha — загружает все тестовые наборы
// Настраивает mocha и импортирует все test suite'ы

import * as path from 'path';

/**
 * Этот файл — точка входа для mocha-тестов, запускаемых внутри VS Code Extension Host.
 * VS Code загружает этот файл через --extensionTestsPath и вызывает экспортированную функцию.
 * 
 * Все тесты должны быть импортированы здесь, чтобы mocha их зарегистрировала.
 */

// Сохраняем оригинальный require для загрузки тестов
const testModules: string[] = [
  './providers.test',
  './streaming.test',
  './tools.test',
  './context.test',
  './conversation.test',
];

/**
 * Функция, вызываемая VS Code при запуске тестов.
 * Настраивает mocha и загружает все тестовые модули.
 */
export function run(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // Настройки mocha уже заданы через .mocharc.yml или package.json,
      // но здесь можно переопределить при необходимости

      // Загружаем все тестовые модули
      for (const mod of testModules) {
        const modulePath = path.resolve(__dirname, mod);
        require(modulePath);
      }

      console.log(`[Тесты] Загружено ${testModules.length} тестовых наборов`);
      console.log(`[Тесты] Наборы: ${testModules.join(', ')}`);

      // Mocha начнёт выполнение автоматически после загрузки всех тестов
      resolve();
    } catch (err) {
      console.error('[Тесты] Ошибка загрузки тестовых модулей:', err);
      reject(err);
    }
  });
}