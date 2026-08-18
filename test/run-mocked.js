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
    // Возвращаем путь к нашему mock-модулю
    return path.resolve(__dirname, '../node_modules/vscode/index.js');
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

// Добавляем тестовые файлы
const testFiles = [
  '../out/test/suite/askUserTool.test.js',
  '../out/test/suite/providers.test.js',
  '../out/test/suite/streaming.test.js',
  '../out/test/suite/tools.test.js',
  '../out/test/suite/context.test.js',
  '../out/test/suite/conversation.test.js',
  '../out/test/suite/session.test.js',
  '../out/test/suite/agentsMd.test.js',
  '../out/test/suite/agentsMdIntegration.test.js',
  '../out/test/suite/contextSummarizer.test.js',
  '../out/test/suite/summaryIntegration.test.js',
  '../out/test/suite/retryHandler.test.js',
  '../out/test/suite/toolAllowList.test.js',
  '../out/test/suite/mcpClient.test.js',
  '../out/test/suite/runHistoryStore.test.js',
  '../out/test/suite/agentWorker.test.js',
  '../out/test/suite/agentOrchestrator.test.js',
  '../out/test/suite/agentCommunication.test.js',
  '../out/test/suite/orchestratorView.test.js',
  '../out/test/suite/roleAgentsMd.test.js',
  '../out/test/suite/slashCommands.test.js',
];

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