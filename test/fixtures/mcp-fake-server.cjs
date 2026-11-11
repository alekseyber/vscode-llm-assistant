#!/usr/bin/env node
// Фейковый MCP-сервер для e2e: минимальный JSON-RPC по stdio, без зависимостей.
//
// Зачем: проверять подключение к настоящему MCP-серверу в CI нельзя (нужен npx и сеть),
// а регресс в рукопожатии и разборе `tools/list` ловится только на живом процессе.
//
// Протокол: initialize → notifications/initialized → tools/list → tools/call.

'use strict';

const PROTOCOL_VERSION = '2024-11-05';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function handle(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  // Уведомление: ответа не требуется
  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'fake_echo',
            description: 'Эхо-инструмент стенда: возвращает переданный текст',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string', description: 'что вернуть' } },
              required: ['text'],
            },
          },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const text = String(params?.arguments?.text ?? '');
    send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `эхо: ${text}` }] },
    });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `неизвестный метод: ${method}` } });
  }
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) {
      try {
        handle(JSON.parse(line));
      } catch (error) {
        process.stderr.write(`фейковый MCP: не разобрал строку: ${String(error)}\n`);
      }
    }
    index = buffer.indexOf('\n');
  }
});
