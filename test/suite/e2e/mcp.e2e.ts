// E2E-17: MCP — подключение к живому процессу по stdio и вызов инструмента.
//
// Почему e2e: `McpClient` запускает дочерний процесс и обменивается рукопожатием по протоколу.
// Юниты на моках этого не видят: ошибка в версии протокола, в разборе `tools/list` или в
// передаче аргументов проявляется только на живом процессе. Настоящий MCP-сервер в CI не
// поднять (нужен npx и сеть), поэтому используется фейковый — `test/fixtures/mcp-fake-server.cjs`,
// он говорит по протоколу JSON-RPC и ничего не требует.
//
// Границы: проверяется рукопожатие, список инструментов и один вызов. Сложные протокольные
// сценарии (реконнект, ошибки сервера, таймауты) остаются юнитам.

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { McpClient, loadMcpConfig } from '../../../src/modes/apply/McpClient';
import { applySettings, SettingsSnapshot } from './helpers/settings';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FAKE_SERVER = path.join(REPO_ROOT, 'test', 'fixtures', 'mcp-fake-server.cjs');

suite('E2E-17: MCP по stdio', function () {
  this.timeout(60_000);

  let snap: SettingsSnapshot | undefined;
  let client: McpClient | undefined;

  /** Конфиг сервера: `node` из PATH (в Extension Host `process.execPath` — это Electron). */
  function serverConfig(name = 'fake', extraArgs: string[] = [], enabled = true) {
    return { name, command: 'node', args: [FAKE_SERVER, ...extraArgs], enabled };
  }

  suiteSetup(function () {
    // Без node в PATH тест упал бы невнятно («Connection closed»)
    try {
      execFileSync('node', ['--version']);
    } catch {
      throw new Error('для E2E-17 нужен node в PATH: тест поднимает MCP-сервер дочерним процессом');
    }
  });

  teardown(async () => {
    client?.disconnect();
    client = undefined;
    await snap?.restore();
  });

  test('E2E-17a: сервер из настроек поднимается, инструменты появляются в списке', async () => {
    snap = await applySettings({
      'mcp.servers': [serverConfig()],
    });

    const configs = loadMcpConfig();
    assert.strictEqual(configs.length, 1, `сервер из настроек прочитан: ${JSON.stringify(configs)}`);
    assert.strictEqual(configs[0].name, 'fake', 'имя сервера как в настройках');

    client = new McpClient(configs[0]);
    const result = await client.connect();

    assert.strictEqual(result.serverName, 'fake', 'подключились к тому серверу');
    assert.ok(result.tools.length > 0, 'сервер отдал инструменты');
    const echo = result.tools.find((tool) => String(tool.name).includes('fake_echo'));
    assert.ok(echo, `инструмент fake_echo в списке: ${JSON.stringify(result.tools.map((t) => t.name))}`);
    assert.ok(String(echo!.description ?? '').length > 0, 'описание инструмента доехало');
  });

  test('E2E-17b: вызов инструмента возвращает ответ сервера', async () => {
    snap = await applySettings({
      'mcp.servers': [serverConfig()],
    });

    client = new McpClient(loadMcpConfig()[0]);
    const { tools } = await client.connect();
    const echo = tools.find((tool) => String(tool.name).includes('fake_echo'));
    assert.ok(echo, 'инструмент найден');

    // Аргументы идут через тот же путь, что у агента: имя инструмента → execute
    const answer = await echo!.execute({ text: 'привет из e2e' });
    assert.ok(
      String(answer).includes('эхо: привет из e2e'),
      `сервер вернул ответ инструмента: ${String(answer).slice(0, 200)}`,
    );
  });

  test('E2E-17c: выключенный сервер отфильтровывается из конфига', async () => {
    snap = await applySettings({
      'mcp.servers': [serverConfig('off', [], false)],
    });

    assert.deepStrictEqual(loadMcpConfig(), [], 'сервер с enabled: false отфильтрован');
  });

  test('E2E-17d: isError от сервера не выглядит как успешный ответ', async () => {
    snap = await applySettings({ 'mcp.servers': [serverConfig()] });
    client = new McpClient(loadMcpConfig()[0]);
    const { tools } = await client.connect();

    const failing = tools.find((tool) => String(tool.name).includes('fake_error'));
    assert.ok(failing, `инструмент fake_error в списке: ${JSON.stringify(tools.map((t) => t.name))}`);

    const answer = String(await failing!.execute({}));
    assert.ok(answer.includes('ошибка инструмента'), `агент видит ошибку, а не результат: ${answer.slice(0, 200)}`);
    assert.ok(answer.includes('сервер сломался'), 'текст ошибки сервера сохранён');
  });

  test('E2E-17e: падение сервера после рукопожатия даёт ошибку, а не зависание', async () => {
    snap = await applySettings({ 'mcp.servers': [serverConfig('crashing', ['--crash'])] });
    client = new McpClient(loadMcpConfig()[0]);
    const { tools } = await client.connect();
    const echo = tools.find((tool) => String(tool.name).includes('fake_echo'));
    assert.ok(echo, 'инструменты получены до падения');

    // Сервер завершится через ~20 мс: вызов обязан завершиться ошибкой, а не висеть до таймаута теста
    await assert.rejects(
      async () => echo!.execute({ text: 'после падения' }),
      (error: Error) => /Connection closed|closed|ECONNRESET|MCP error/i.test(String(error.message)),
      'падение сервера превращается в понятную ошибку',
    );
  });
});
