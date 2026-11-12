// Тесты инструментов чат-агента (ChatAgentTools) — 373 строки, до этого 2 теста на статистику.
//
// Проверяется поведение инструментов, которыми агент трогает файлы проекта: чтение с
// нумерацией строк и окном, запись с созданием каталогов и идемпотентностью, замена только
// первого вхождения, делегирование, allow-list.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mockInternals, resetSettings, setSetting, setWorkspaceRoot } from '../support/vscode-harness';
import * as fsNode from 'fs';
import * as osNode from 'os';
import * as pathNode from 'path';
import {
  getTool,
  getToolSchemas,
  getToolSchemasUnfiltered,
  getToolUnfiltered,
  setDelegateHandler,
} from '../../src/modes/chat/ChatAgentTools';

/**
 * Форма схемы function calling, которую отдают getToolSchemas()/getToolSchemasUnfiltered().
 * `Record<string, unknown>` в базе — чтобы сужение с этой формы оставалось прямым приведением.
 */
interface FunctionCallSchema extends Record<string, unknown> {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type?: string; properties?: Record<string, unknown>; required?: string[] };
  };
}

/**
 * Снять обработчик делегирования: поле в ChatAgentTools допускает `null`, а сеттер
 * принимает только функцию — «не настроено» выражается отсутствием значения.
 */
const NO_DELEGATE_HANDLER = undefined as unknown as (role: string, task: string) => Promise<string>;

const fsMock = () => mockInternals().fs;

function putFile(relativePath: string, content: string): string {
  const full = `/fake/workspace/${relativePath}`;
  fsMock().files.set(full, new TextEncoder().encode(content));
  return full;
}

function readFileText(fullPath: string): string {
  const data = fsMock().files.get(fullPath);
  assert.ok(data, `файла ${fullPath} нет в памяти`);
  return new TextDecoder().decode(data);
}

const readFile = () => getToolUnfiltered('read_file')!;
const writeFile = () => getToolUnfiltered('write_file')!;
const replaceInFile = () => getToolUnfiltered('replace_in_file')!;
const delegate = () => getToolUnfiltered('delegate_to_agent')!;
const listFiles = () => getToolUnfiltered('list_files')!;
const searchFiles = () => getToolUnfiltered('search_files')!;
const runTerminal = () => getToolUnfiltered('run_terminal')!;
const webFetch = () => getToolUnfiltered('web_fetch')!;

suite('ChatAgentTools', () => {
  setup(() => {
    fsMock().files.clear();
    fsMock().dirs.clear();
    resetSettings();
  });

  test('CAT-1: read_file нумерует строки и сообщает диапазон', async () => {
    putFile('src/a.ts', 'line1\nline2\nline3\n');
    const result = await readFile().execute({ path: 'src/a.ts' });
    assert.ok(result.includes('Файл:'), `есть заголовок: ${result}`);
    assert.ok(result.includes('строк 1-4 из 4'), `диапазон указан: ${result}`);
    assert.ok(/\s*1\| line1/.test(result), `первая строка пронумерована: ${result}`);
    assert.ok(/\s*3\| line3/.test(result), `третья строка пронумерована: ${result}`);
  });

  test('CAT-2: read_file учитывает offset и limit', async () => {
    putFile('src/b.ts', Array.from({ length: 10 }, (_, i) => `row${i + 1}`).join('\n'));
    const result = await readFile().execute({ path: 'src/b.ts', offset: 3, limit: 2 });
    assert.ok(result.includes('строк 3-4 из 10'), `окно применено: ${result}`);
    assert.ok(result.includes('row3') && result.includes('row4'), 'в окне нужные строки');
    assert.ok(!result.includes('row1') && !result.includes('row5'), 'строки вне окна не попали');
  });

  test('CAT-3: read_file на отсутствующем файле возвращает ошибку, а не пустой текст', async () => {
    await assert.rejects(
      () => readFile().execute({ path: 'src/missing.ts' }),
      (error: any) => /FileNotFound|missing/i.test(String(error?.message ?? error)),
      'отсутствующий файл должен давать ошибку',
    );
  });

  test('CAT-4: write_file создаёт каталоги и пишет содержимое', async () => {
    const full = '/fake/workspace/src/deep/nested/c.ts';
    const result = await writeFile().execute({ path: 'src/deep/nested/c.ts', content: 'export const c = 3;' });
    assert.ok(result.includes('Файл записан'), `подтверждение записи: ${result}`);
    assert.strictEqual(readFileText(full), 'export const c = 3;');
    assert.ok(fsMock().dirs.has('/fake/workspace/src/deep/nested'), 'каталог создан');
  });

  test('CAT-5: write_file не считает изменением повторную запись того же текста', async () => {
    putFile('src/same.ts', 'const same = true;');
    const result = await writeFile().execute({ path: 'src/same.ts', content: 'const same = true;' });
    assert.ok(result.includes('Файл не изменён'), `идемпотентность: ${result}`);
  });

  test('CAT-6: replace_in_file заменяет только первое вхождение', async () => {
    const full = putFile('src/dup.ts', 'const a = 1;\nconst a = 1;\n');
    const result = await replaceInFile().execute({ path: 'src/dup.ts', old_str: 'const a = 1;', new_str: 'const a = 2;' });
    assert.ok(result.includes('Файл обновлён'), result);
    assert.strictEqual(readFileText(full), 'const a = 2;\nconst a = 1;\n', 'заменено ровно одно вхождение');
  });

  test('CAT-7: replace_in_file при отсутствии текста не портит файл', async () => {
    const full = putFile('src/keep.ts', 'original content');
    const result = await replaceInFile().execute({ path: 'src/keep.ts', old_str: 'нет такого', new_str: 'x' });
    assert.ok(result.includes('Ошибка'), `сообщение об ошибке: ${result}`);
    assert.strictEqual(readFileText(full), 'original content', 'файл не изменён');
  });

  test('CAT-8: delegate_to_agent без настроенного обработчика объясняет причину', async () => {
    setDelegateHandler(NO_DELEGATE_HANDLER);
    const result = await delegate().execute({ role: 'coder', task: 'сделай' });
    assert.ok(result.includes('делегирование не настроено'), `причина названа: ${result}`);
  });

  test('CAT-9: delegate_to_agent передаёт роль и задачу обработчику', async () => {
    const seen: Array<[string, string]> = [];
    setDelegateHandler(async (role, task) => {
      seen.push([role, task]);
      return `готово: ${role}`;
    });
    const result = await delegate().execute({ role: 'reviewer', task: 'проверь дифф' });
    assert.deepStrictEqual(seen, [['reviewer', 'проверь дифф']]);
    assert.strictEqual(result, 'готово: reviewer');
  });

  test('CAT-10: ошибка обработчика делегирования возвращается как текст, а не исключение', async () => {
    setDelegateHandler(async () => {
      throw new Error('роль не найдена');
    });
    const result = await delegate().execute({ role: 'ghost', task: 'ничего' });
    assert.ok(result.includes('Ошибка делегирования'), result);
    assert.ok(result.includes('роль не найдена'), result);
    setDelegateHandler(NO_DELEGATE_HANDLER);
  });

  test('CAT-11: allow-list скрывает инструменты из схем, но не из внутреннего списка', () => {
    setSetting('apply.allowedTools', ['read_file']);
    const schemas = (getToolSchemas() as FunctionCallSchema[]).map((schema) => schema.function.name);
    assert.deepStrictEqual(schemas, ['read_file'], `в схемах только разрешённый: ${JSON.stringify(schemas)}`);
    assert.strictEqual(getTool('write_file'), undefined, 'запрещённый инструмент не выдаётся агенту');
    assert.ok(getToolUnfiltered('write_file'), 'внутренний список не тронут');
    assert.strictEqual(getToolSchemasUnfiltered().length, 9, 'нефильтрованные схемы содержат все инструменты');
  });

  test('CAT-12: схема инструмента пригодна для function calling', async () => {
    for (const schema of getToolSchemasUnfiltered() as FunctionCallSchema[]) {
      assert.strictEqual(schema.type, 'function');
      assert.ok(schema.function.name, 'у инструмента есть имя');
      assert.strictEqual(schema.function.parameters.type, 'object', `${schema.function.name}: параметры — объект`);
      assert.ok(Array.isArray(schema.function.parameters.required), `${schema.function.name}: required — массив`);
    }
  });

  test('CAT-13: list_files помечает папки и файлы и не лезет в скрытое и node_modules', async () => {
    putFile('src/a.ts', 'export const a = 1;');
    putFile('src/deep/b.ts', 'export const b = 2;');
    putFile('node_modules/pkg/index.js', 'module.exports = {};');
    putFile('.hidden/secret.txt', 'секрет');
    fsMock().dirs.add('/fake/workspace/src/deep');
    fsMock().dirs.add('/fake/workspace/node_modules');
    fsMock().dirs.add('/fake/workspace/.hidden');

    // Смотрим с корня: именно там лежат node_modules и скрытый каталог
    const result = await listFiles().execute({ path: '.', depth: 3 });
    assert.ok(result.includes('📁 src'), `каталог виден: ${result}`);
    assert.ok(result.includes('📄 a.ts'), `файл виден: ${result}`);
    assert.ok(result.includes('b.ts'), `вложенность показана: ${result}`);
    assert.ok(!result.includes('node_modules'), 'служебные каталоги пропущены');
    assert.ok(!result.includes('.hidden') && !result.includes('secret.txt'), 'скрытые каталоги пропущены');
  });

  test('CAT-14: search_files находит по содержимому и по имени, невалидный regex не роняет агента', async () => {
    const a = putFile('src/one.ts', 'const target = 1;\nconst other = 2;');
    const b = putFile('src/target-helper.ts', 'export const nothing = 0;');
    mockInternals().findFilesResult = [a, b];

    const byContent = await searchFiles().execute({ pattern: 'target' });
    assert.ok(byContent.includes('one.ts:1'), `строка с совпадением: ${byContent}`);

    mockInternals().findFilesResult = [a, b];
    const byName = await searchFiles().execute({ pattern: 'helper' });
    assert.ok(byName.includes('target-helper.ts'), `совпадение по имени файла: ${byName}`);

    const invalid = await searchFiles().execute({ pattern: '([' });
    assert.ok(invalid.includes('Ошибка'), `невалидный regex объяснён: ${invalid}`);
    mockInternals().findFilesResult = [];
  });

  test('CAT-15: run_terminal возвращает текст команды, а не исключение', async () => {
    // Корень workspace в тестах виртуальный; команда запускается в настоящем каталоге
    const realRoot = fsNode.mkdtempSync(pathNode.join(osNode.tmpdir(), 'tools-'));
    setWorkspaceRoot(realRoot);
    try {
      const result = await runTerminal().execute({
        command: `${process.execPath} -e "console.log('hello from tool')"`,
        timeout: 10,
      });
      assert.ok(typeof result === 'string' && result.length > 0, 'результат — непустая строка');
      assert.ok(result.includes('hello from tool'), `вывод команды попал в результат: ${result}`);
    } finally {
      setWorkspaceRoot('/fake/workspace');
      fsNode.rmSync(realRoot, { recursive: true, force: true });
    }
  });

  test('CAT-16: web_fetch извлекает текст страницы и выбрасывает разметку', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        '<html><body><nav>меню</nav><script>alert(1)</script><p>Полезный текст страницы</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    try {
      const result = await webFetch().execute({ url: 'https://example.com/page' });
      assert.ok(result.includes('Полезный текст страницы'), `текст извлечён: ${result}`);
      assert.ok(!result.includes('<p>'), 'разметка выброшена');
      assert.ok(!result.includes('alert(1)'), 'скрипты выброшены');
      assert.ok(!result.includes('меню'), 'навигация выброшена');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('CAT-17: HTTP-ошибка web_fetch возвращается как текст, а не как страница', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response('<html><body>доступ закрыт</body></html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      });
    try {
      const result = await webFetch().execute({ url: 'https://example.com/private' });
      assert.ok(result.includes('403'), `код ошибки виден: ${result}`);
      assert.ok(!result.includes('доступ закрыт'), 'тело ошибки не выдаётся за содержимое');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('CAT-18: таймаут web_fetch возвращается как ошибка, а не как пустая страница', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    }) as typeof fetch;
    try {
      const result = await webFetch().execute({ url: 'https://example.com/slow' });
      assert.ok(result.includes('Ошибка'), `таймаут объяснён: ${result}`);
      assert.ok(result.includes('timeout') || result.includes('aborted'), `причина названа: ${result}`);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
