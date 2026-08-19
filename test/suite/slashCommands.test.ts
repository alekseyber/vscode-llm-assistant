// Тесты для SlashCommands — слэш-команды код-действий в чате (фича P1)
import 'mocha';
import * as assert from 'assert';
import { SLASH_COMMANDS, parseSlashCommand, getSlashCommand } from '../../src/modes/chat/SlashCommands';

suite('SlashCommands', () => {
  test('SL-1: SLASH_COMMANDS содержит 6 команд', () => {
    assert.strictEqual(SLASH_COMMANDS.length, 6);
    const names = SLASH_COMMANDS.map((c) => c.name);
    assert.deepStrictEqual(names, ['explain', 'explain_stepbystep', 'doc', 'test', 'review', 'improve']);
  });

  test('SL-1: каждая команда имеет все обязательные поля', () => {
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(cmd.name, `name у ${cmd.name}`);
      assert.ok(cmd.description.length > 0, `description у ${cmd.name}`);
      assert.ok(cmd.defaultTask.length > 0, `defaultTask у ${cmd.name}`);
      assert.ok(cmd.promptTemplate.length > 0, `promptTemplate у ${cmd.name}`);
    }
  });

  test('SL-2.1: parseSlashCommand("/explain") → пустой аргумент', () => {
    const r = parseSlashCommand('/explain');
    assert.ok(r, 'должен быть результат');
    assert.strictEqual(r!.name, 'explain');
    assert.strictEqual(r!.argument, '');
  });

  test('SL-2.2: parseSlashCommand("/doc функция main") → аргумент', () => {
    const r = parseSlashCommand('/doc функция main');
    assert.ok(r);
    assert.strictEqual(r!.name, 'doc');
    assert.strictEqual(r!.argument, 'функция main');
  });

  test('SL-2.3: parseSlashCommand("обычный текст") → null', () => {
    assert.strictEqual(parseSlashCommand('обычный текст'), null);
    assert.strictEqual(parseSlashCommand(''), null);
    assert.strictEqual(parseSlashCommand('  /explain'), null); // пробел в начале — не команда
  });

  test('SL-2.4: лишние пробелы между именем и аргументом', () => {
    const r = parseSlashCommand('/doc   foo');
    assert.ok(r);
    assert.strictEqual(r!.name, 'doc');
    assert.strictEqual(r!.argument, 'foo');
  });

  test('SL-3.1: getSlashCommand("explain") возвращает команду с промптом', () => {
    const cmd = getSlashCommand('explain');
    assert.ok(cmd);
    assert.ok(cmd!.promptTemplate.includes('Слэш-команда /explain'));
  });

  test('SL-3.2: getSlashCommand("unknown") → undefined', () => {
    assert.strictEqual(getSlashCommand('unknown'), undefined);
  });

  test('SL-4: все 6 команд резолвятся через getSlashCommand()', () => {
    for (const cmd of SLASH_COMMANDS) {
      const found = getSlashCommand(cmd.name);
      assert.ok(found, `команда ${cmd.name} должна резолвиться`);
      assert.strictEqual(found!.name, cmd.name);
    }
  });

  test('SL-5: promptTemplate содержит заголовок «Слэш-команда /<имя>»', () => {
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(
        cmd.promptTemplate.includes(`Слэш-команда /${cmd.name}`),
        `заголовок у /${cmd.name}`,
      );
    }
  });

  test('SL-5: promptTemplate НЕ содержит ⚠️ (не удаляется очисткой AgentWorker)', () => {
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(
        !cmd.promptTemplate.includes('⚠️'),
        `промпт /${cmd.name} не должен содержать ⚠️`,
      );
    }
  });

  test('Директива READ_CODE_ONLY: читай только файл кода, не скилы', () => {
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(
        cmd.promptTemplate.includes('читай ТОЛЬКО файл с кодом'),
        `директива «читай только файл кода» у /${cmd.name}`,
      );
      assert.ok(
        cmd.promptTemplate.includes('.llma/skills/'),
        `упоминание .llma/skills/ у /${cmd.name}`,
      );
    }
  });

  test('SL-6: флаг writes — /doc и /test записывают файл, остальные нет', () => {
    const writing = SLASH_COMMANDS.filter((c) => c.writes).map((c) => c.name);
    assert.deepStrictEqual(writing, ['doc', 'test']);
    for (const cmd of SLASH_COMMANDS) {
      if (cmd.name === 'doc' || cmd.name === 'test') {
        assert.strictEqual(cmd.writes, true, `/${cmd.name} должен иметь writes=true`);
      } else {
        assert.strictEqual(cmd.writes, false, `/${cmd.name} должен иметь writes=false`);
      }
    }
  });

  test('SL-7: директива FOCUS_ON_ARGUMENT — уважать названную функцию/класс', () => {
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(
        cmd.promptTemplate.includes('работай ТОЛЬКО с ней'),
        `директива «работай только с названной сущностью» у /${cmd.name}`,
      );
    }
  });
});
