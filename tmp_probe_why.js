// Почему модель иногда не вызывает инструмент: сравниваем два варианта запроса.
// A — короткий контекст; B — как в плагине (файл настроек прикреплён к user-сообщению).
const path = require('path');
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') return path.resolve(__dirname, 'test/mocks/vscode/index.js');
  return orig.call(this, request, parent, isMain, options);
};
const { OllamaProvider } = require('./out/src/providers/ollama');
const { createTools } = require('./out/src/modes/apply/ToolDefinitions');
const chatTools = require('./out/src/modes/chat/ChatAgentTools');
const fs = require('fs');

const SETTINGS = fs.readFileSync('/opt/data/projects/test-project/.vscode/settings.json', 'utf8');

(async () => {
  createTools();
  const schemas = chatTools.getToolSchemas();
  const provider = new OllamaProvider({ name: 'local', baseUrl: 'http://ollama:11434', models: ['qwen3:8b'] });
  const sys = 'Ты — AI-агент в VS Code с инструментами. Для чтения файлов используй инструмент read_file.\n\n## Правила (AGENTS.md):\n- Всегда отвечай с эмодзи в начале\n- Называй меня «Капитан»\n- Добавляй подпись «— Бот» в конце';
  const q = 'прочитай README.md и перескажи первый абзац';

  async function run(label, messages) {
    const t0 = Date.now();
    const res = await provider.createWithTools(messages, 'qwen3:8b', schemas);
    const msg = res.choices[0].message;
    console.log(`[${label}] ${Date.now() - t0}ms tool_calls=${msg.tool_calls ? msg.tool_calls.map(c => c.function.name + ' ' + c.function.arguments).join(',') : 'НЕТ'} content=${JSON.stringify((msg.content || '').slice(0, 80))}`);
  }

  await run('A: короткий контекст', [
    { role: 'system', content: sys },
    { role: 'user', content: q },
  ]);

  await run('B: с прикреплённым settings.json', [
    { role: 'system', content: sys },
    { role: 'user', content: `--- Файл: /opt/data/projects/test-project/.vscode/settings.json ---\n\`\`\`\n${SETTINGS}\n\`\`\`` },
    { role: 'user', content: q },
  ]);

  await run('B повт.', [
    { role: 'system', content: sys },
    { role: 'user', content: `--- Файл: /opt/data/projects/test-project/.vscode/settings.json ---\n\`\`\`\n${SETTINGS}\n\`\`\`` },
    { role: 'user', content: q },
  ]);
})();
