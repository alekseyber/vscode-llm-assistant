// Проверка манифеста скиллов: frontmatter, версии, даты, дубли имён.
//
// Скилл — инструкция агенту, поэтому правка `.md` меняет поведение. Гейт в CI проверяет
// то, что видно в диффе: имя, описание, версию, дату, размер и отсутствие дублей.

import 'mocha';
import * as assert from 'assert';
import {
  validateChangedSkill,
  validateSkillContent,
  findDuplicateNames,
  parseSkillFrontmatter,
  MAX_SKILL_BYTES,
} from '../../src/shared/SkillManifest';

const good = `---
name: coder
description: Правила написания кода
version: 1.2.0
updated: 2026-11-12
---

# Coder
`;

suite('SkillManifest', () => {
  test('SKM-1: корректный манифест проходит без ошибок', () => {
    const result = validateSkillContent(good, '.llma/skills/coder.md');
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.name, 'coder');
    assert.strictEqual(result.version, '1.2.0');
    assert.strictEqual(result.updated, '2026-11-12');
  });

  test('SKM-2: без name — ошибка, файл не попадёт в каталог', () => {
    const result = validateSkillContent('---\ndescription: без имени\n---\n');
    assert.ok(result.errors.some((e) => e.includes('нет name')), result.errors.join('; '));
  });

  test('SKM-3: без description — ошибка', () => {
    const result = validateSkillContent('---\nname: coder\n---\n');
    assert.ok(result.errors.some((e) => e.includes('нет description')), result.errors.join('; '));
  });

  test('SKM-4: имя с пробелами отклоняется', () => {
    const result = validateSkillContent('---\nname: my skill\ndescription: x\n---\n');
    assert.ok(result.errors.some((e) => e.includes('пробелы')), result.errors.join('; '));
  });

  test('SKM-5: версия не в формате x.y.z — ошибка, формат не угадываем', () => {
    for (const version of ['1.2', 'v1.2.0', 'latest']) {
      const result = validateSkillContent(`---\nname: coder\ndescription: x\nversion: ${version}\n---\n`);
      assert.ok(result.errors.some((e) => e.includes('x.y.z')), `версия ${version}: ${result.errors.join('; ')}`);
    }
  });

  test('SKM-6: дата обновления проверяется по формату', () => {
    const result = validateSkillContent('---\nname: coder\ndescription: x\nupdated: 12.11.2026\n---\n');
    assert.ok(result.errors.some((e) => e.includes('YYYY-MM-DD')), result.errors.join('; '));
  });

  test('SKM-7: файл больше лимита отклоняется', () => {
    const huge = `---\nname: big\ndescription: x\n---\n${'a'.repeat(MAX_SKILL_BYTES + 10)}`;
    const result = validateSkillContent(huge, 'big.md');
    assert.ok(result.errors.some((e) => e.includes('больше лимита')), result.errors.join('; '));
  });

  test('SKM-8: дубли имён ловятся без учёта регистра', () => {
    const errors = findDuplicateNames([
      { name: 'Coder', filePath: '.llma/skills/coder.md' },
      { name: 'coder', filePath: '.claude/skills/coder/SKILL.md' },
    ]);
    assert.strictEqual(errors.length, 1, errors.join('; '));
    assert.ok(errors[0].includes('встречается дважды'), errors[0]);
  });

  test('SKM-9: frontmatter без версии и даты допустим — поля опциональны', () => {
    const result = validateSkillContent('---\nname: plain\ndescription: без версии\n---\nтело скилла\n', 'plain.md');
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.version, undefined);
  });

  test('SKM-10: frontmatter парсится с кавычками и CRLF', () => {
    const meta = parseSkillFrontmatter('---\r\nname: "quoted"\r\ndescription: \'single\'\r\n---\r\n');
    assert.strictEqual(meta.name, 'quoted');
    assert.strictEqual(meta.description, 'single');
  });

  test('SKM-11: имя, не совпадающее с файлом, отклоняется — иначе скилл не найдётся', () => {
    const result = validateSkillContent(
      '---\nname: coder\ndescription: x\n---\n',
      '.claude/skills/reviewer/SKILL.md',
    );
    assert.ok(result.errors.some((e) => e.includes('не совпадает')), result.errors.join('; '));
  });

  test('SKM-12: многострочный frontmatter не разбирается молча — явная ошибка', () => {
    const result = validateSkillContent(
      '---\nname: coder\ndescription: |\n  строка 1\n  строка 2\n---\n',
      'coder.md',
    );
    assert.ok(result.errors.some((e) => e.includes('не поддерживается')), result.errors.join('; '));
  });

  test('SKM-13: правка без изменения version/updated отклоняется', () => {
    const before = '---\nname: coder\ndescription: x\nversion: 1.0.0\nupdated: 2026-11-01\n---\nтело\n';
    const errors = validateChangedSkill('.llma/skills/coder.md', before, before.replace('тело', 'другое тело'));
    assert.strictEqual(errors.length, 1, errors.join('; '));
    assert.ok(errors[0].includes('отметьте правку'), errors[0]);
  });

  test('SKM-14: рост версии или смена даты снимают замечание', () => {
    const base = '---\nname: coder\ndescription: x\nversion: 1.0.0\nupdated: 2026-11-01\n---\n';
    assert.deepStrictEqual(validateChangedSkill('coder.md', base, base.replace('1.0.0', '1.0.1')), []);
    assert.deepStrictEqual(validateChangedSkill('coder.md', base, base.replace('2026-11-01', '2026-11-12')), []);
  });

  test('SKM-15: правка файла без полей версии тоже требует отметки', () => {
    const before = '---\nname: coder\ndescription: x\n---\nтело\n';
    const errors = validateChangedSkill('coder.md', before, before.replace('тело', 'тело2'));
    assert.strictEqual(errors.length, 1, errors.join('; '));
  });

  test('SKM-16: скилл с одним frontmatter без тела отклоняется', () => {
    const result = validateSkillContent('---\nname: empty\ndescription: без тела\n---\n', 'empty.md');
    assert.ok(result.errors.some((e) => e.includes('пустое тело')), result.errors.join('; '));
  });

  test('SKM-17: тело из одних пробелов тоже считается пустым', () => {
    const result = validateSkillContent('---\nname: blank\ndescription: x\n---\n   \n\t\n', 'blank.md');
    assert.ok(result.errors.some((e) => e.includes('пустое тело')), result.errors.join('; '));
  });
});
