// Запуск тестов mocha вне VS Code Extension Host
// Подменяет vscode модуль на mock и запускает все тестовые наборы

// Настраиваем mock vscode модуля до загрузки тестов
const path = require('path');
const Module = require('module');

// Сохраняем оригинальный resolveFilename
const originalResolve = Module._resolveFilename;

// Перехватываем запросы модуля 'vscode'
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') {
    // Возвращаем путь к нашему mock-модулю (git-трекается, не в node_modules)
    return path.resolve(__dirname, 'mocks/vscode/index.js');
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// Запускаем mocha программно
const Mocha = require('mocha');

// Создаём экземпляр mocha
const mocha = new Mocha({
  ui: 'tdd', // Используем TDD-style (suite/test как в VS Code тестах)
  timeout: 10000,
  reporter: 'spec',
  color: true,
});

// Добавляем тестовые файлы: все скомпилированные *.test.js из out/test/suite.
// Раньше список был захардкожен, и новый файл тестов молча не запускался.
const fs = require('fs');
const suiteDir = path.resolve(__dirname, '../out/test/suite');
const testFiles = fs
  .readdirSync(suiteDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => `../out/test/suite/${f}`);

for (const file of testFiles) {
  const fullPath = path.resolve(__dirname, file);
  mocha.addFile(fullPath);
  console.log(`Добавлен тест: ${fullPath}`);
}

// Запускаем
mocha.run(function (failures) {
  console.log(`\n=== Всего провалов: ${failures} ===`);
  process.exitCode = failures ? 1 : 0;
});