// E2E: полный ReAct-цикл apply-режима с реальными файловыми эффектами.
// Мок-провайдер возвращает заскриптованные ответы (tool_call → финальный ответ),
// а write_file пишет через реальный VS Code fs API в темповую папку.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolSystem } from '../../../src/modes/apply/ToolSystem';
import { createTools } from '../../../src/modes/apply/ToolDefinitions';
import { AgentController } from '../../../src/modes/apply/AgentController';

suite('E2E: ReAct-цикл apply-режима', () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-e2e-'));
    // Отключаем summary, чтобы цикл был детерминированным (иначе сжимает историю и дёргает провайдера лишний раз)
    await vscode.workspace.getConfiguration('llmAssistant').update('chat.summaryEnabled', false, vscode.ConfigurationTarget.Global);
  });

  teardown(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('write_file создаёт файл в темповой папке, агент возвращает финальный ответ', async () => {
    const toolSystem = new ToolSystem();
    toolSystem.registerAll(createTools());
    const agent = new AgentController(toolSystem);

    const targetFile = path.join(tmpDir, 'hello.txt');
    const targetContent = 'привет из E2E-теста';

    // Мок-провайдер: 1-й вызов — JSON tool_call, 2-й — финальный ответ текстом
    let call = 0;
    const provider: any = {
      chat: async function* (messages: any[], opts: any, signal?: AbortSignal) {
        call++;
        if (call === 1) {
          yield JSON.stringify({ tool: 'write_file', arguments: { path: targetFile, content: targetContent } });
        } else {
          yield 'Файл создан успешно.';
        }
      },
    };

    const result = await agent.run({
      provider,
      model: 'test-model',
      task: 'Создай файл hello.txt с текстом',
      maxIterations: 5,
    });

    // Реальный файловый эффект через VS Code fs API
    assert.ok(fs.existsSync(targetFile), 'файл создан в workspace');
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), targetContent, 'содержимое совпадает');

    // ReAct-цикл: tool_call → финальный ответ = 2 итерации
    assert.strictEqual(result.answer, 'Файл создан успешно.');
    assert.strictEqual(result.iterations, 2);
    assert.ok(result.steps.some((s) => s.type === 'tool_call' && s.tool === 'write_file'), 'был вызов write_file');
    assert.ok(result.steps.some((s) => s.type === 'tool_result' && s.tool === 'write_file'), 'был результат write_file');
  });

  test('агент без tool-вызова сразу возвращает финальный ответ', async () => {
    const toolSystem = new ToolSystem();
    toolSystem.registerAll(createTools());
    const agent = new AgentController(toolSystem);

    const provider: any = {
      chat: async function* () {
        yield 'Простой ответ без инструментов.';
      },
    };

    const result = await agent.run({
      provider,
      model: 'test-model',
      task: 'просто ответь',
      maxIterations: 3,
    });

    assert.strictEqual(result.answer, 'Простой ответ без инструментов.');
    assert.strictEqual(result.iterations, 1);
    assert.strictEqual(result.limitExceeded, false);
  });

  test('read_file читает файл, observation содержит содержимое (2 шага)', async () => {
    const notePath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(notePath, 'секретное содержимое', 'utf-8');

    const toolSystem = new ToolSystem();
    toolSystem.registerAll(createTools());
    const agent = new AgentController(toolSystem);

    let call = 0;
    const provider: any = {
      chat: async function* () {
        call++;
        if (call === 1) yield JSON.stringify({ tool: 'read_file', arguments: { path: notePath } });
        else yield 'Файл прочитан.';
      },
    };

    const result = await agent.run({ provider, model: 'test-model', task: 'прочитай note.txt', maxIterations: 5 });

    assert.strictEqual(result.answer, 'Файл прочитан.');
    assert.strictEqual(result.iterations, 2);
    assert.ok(result.steps.some((s) => s.type === 'tool_call' && s.tool === 'read_file'), 'был вызов read_file');
    const toolResult = result.steps.find((s) => s.type === 'tool_result' && s.tool === 'read_file');
    assert.ok((toolResult!.result as string).includes('секретное содержимое'), 'observation содержит содержимое файла');
  });

  test('лимит итераций → limitExceeded', async () => {
    const toolSystem = new ToolSystem();
    toolSystem.registerAll(createTools());
    const agent = new AgentController(toolSystem);

    // Провайдер всегда возвращает tool_call и никогда финальный ответ
    const provider: any = {
      chat: async function* () {
        yield JSON.stringify({ tool: 'read_file', arguments: { path: path.join(tmpDir, 'missing.txt') } });
      },
    };

    const result = await agent.run({ provider, model: 'test-model', task: 'бесконечная задача', maxIterations: 3 });

    assert.strictEqual(result.limitExceeded, true);
    assert.strictEqual(result.iterations, 3);
  });

  test('ошибка инструмента возвращается как observation, агент продолжает', async () => {
    const toolSystem = new ToolSystem();
    toolSystem.registerAll(createTools());
    const agent = new AgentController(toolSystem);

    let call = 0;
    const provider: any = {
      chat: async function* () {
        call++;
        if (call === 1) yield JSON.stringify({ tool: 'read_file', arguments: { path: path.join(tmpDir, 'missing.txt') } });
        else yield 'Не нашёл файл, завершаю.';
      },
    };

    const result = await agent.run({ provider, model: 'test-model', task: 'прочитай missing.txt', maxIterations: 5 });

    assert.strictEqual(result.iterations, 2, 'агент продолжил после ошибки');
    const toolResult = result.steps.find((s) => s.type === 'tool_result');
    assert.ok((toolResult!.result as string).includes('Ошибка'), 'observation содержит ошибку');
  });

  test('отмена через signal → cancelled', async () => {
    const toolSystem = new ToolSystem();
    toolSystem.registerAll(createTools());
    const agent = new AgentController(toolSystem);

    const controller = new AbortController();
    const provider: any = {
      chat: async function* () {
        controller.abort(); // отменяем во время первого вызова
        yield JSON.stringify({ tool: 'read_file', arguments: { path: 'x' } });
      },
    };

    const result = await agent.run({ provider, model: 'test-model', task: 'задача', maxIterations: 5, signal: controller.signal });

    assert.strictEqual(result.cancelled, true);
  });
});
