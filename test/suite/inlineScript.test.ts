// Экранирование JS перед вставкой в <script>: ломает ли панель закрывающий тег в исходнике.

import 'mocha';
import * as assert from 'assert';
import { escapeInlineScript } from '../../src/shared/inlineScript';

suite('inlineScript', () => {
  test('IS-1: </script> в строке экранируется и не закрывает тег', () => {
    const out = escapeInlineScript('const s = "</script>";');
    assert.ok(!out.includes('</script>'), `тег остался: ${out}`);
    assert.ok(out.includes('<\\/script'), `нет экранирования: ${out}`);
  });

  test('IS-2: регистр не важен', () => {
    assert.ok(!escapeInlineScript('"</SCRIPT>"').includes('</SCRIPT>'));
  });

  test('IS-3: обычный код не меняется', () => {
    const source = 'function f(a) { return a + 1; }';
    assert.strictEqual(escapeInlineScript(source), source);
  });
});
