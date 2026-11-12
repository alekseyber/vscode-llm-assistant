// Тесты признака локальности по адресу (P18.1): llama.cpp/LM Studio идут как type:'openai'.
// AC: LZ-1, LZ-2, LZ-3

import 'mocha';
import * as assert from 'assert';
import { isLocalBaseUrl } from '../../src/providers/base';

suite('Локальность по адресу (isLocalBaseUrl)', () => {
  test('LZ-1: loopback в любых формах — локальный', () => {
    const local = [
      'http://127.0.0.1:8080/v1',
      'http://127.0.0.1:11434',
      'https://localhost:1234/v1',
      'http://localhost/v1',
      'http://app.localhost:8080/v1',
      'http://[::1]:8080/v1',
      '127.0.0.1:8080/v1',
      'HTTP://127.0.0.1:8080/v1',
      'http://127.1.2.3:8080/v1',
    ];
    for (const url of local) {
      assert.strictEqual(isLocalBaseUrl(url), true, `должен быть локальным: ${url}`);
    }
  });

  test('LZ-2: облачные и неоднозначные адреса — не локальные', () => {
    const remote = [
      'https://api.openai.com/v1',
      'https://api.deepseek.com/v1',
      'https://hermes-ai-api.alexfdev.ru/v1',
      'http://192.168.1.102:11434/v1',
      'http://10.0.0.5:8080/v1',
      'http://128.0.0.1:8080/v1',
      'http://127.0.0.999:8080/v1',
      'http://::1:8080/v1', // IPv6 без скобок — невалидный URL по RFC, локальным не считаем
      '',
      undefined as unknown as string, // cast-ok: проверяем защиту от undefined на входе
      'http://${HOST}:8080/v1',
    ];
    for (const url of remote) {
      assert.strictEqual(isLocalBaseUrl(url), false, `не должен быть локальным: ${String(url)}`);
    }
  });

  test('LZ-3: путь и query не влияют на вердикт', () => {
    assert.strictEqual(isLocalBaseUrl('http://127.0.0.1:8080/v1/chat/completions?x=1'), true);
    assert.strictEqual(isLocalBaseUrl('https://api.openai.com/v1?debug=1'), false);
  });
});
