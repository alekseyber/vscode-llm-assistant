// Тесты IndexService — деградация без потери понятности.
//
// В тестовом окружении `__dirname` указывает на `out/src/shared`, где `dist/sqlite` нет —
// это ровно та ситуация, в которой оказывается пользователь, если модуль не попал в пакет.
// Проверяем, что сервис не падает и объясняет причину, а не отдаёт ERR_MODULE_NOT_FOUND.

import 'mocha';
import * as assert from 'assert';
import { IndexService, SqliteLoader } from '../../src/shared/IndexService';

suite('IndexService / деградация', () => {
  const context: any = {
    globalStorageUri: { fsPath: '/tmp/llma-index-test' },
    subscriptions: [],
  };

  test('IDX-24: без dist/sqlite сервис не поднимается и называет причину', async () => {
    const messages: string[] = [];
    const service = await IndexService.start(context, (message) => messages.push(message));

    assert.strictEqual(service, undefined, 'индекс не должен считаться рабочим без модуля');
    const joined = messages.join('\n');
    assert.ok(
      joined.includes('Файл индекса не найден'),
      `сообщение должно объяснять причину, а не отдавать код ошибки Node: ${joined}`,
    );
    assert.ok(
      joined.includes('sqlite'),
      `сообщение должно указывать, чего именно нет: ${joined}`,
    );
  });

  test('IDX-25: неудачная загрузка не кэшируется — повторная попытка снова пробует модуль', async () => {
    // Ошибка не должна залипать в кэше промиса: иначе после пересборки расширение
    // до перезапуска окна оставалось бы без индекса
    let attempts = 0;
    const loader = new SqliteLoader(
      async () => {
        attempts += 1;
        throw new Error('модуль не загрузился');
      },
      () => true,
    );

    await assert.rejects(() => loader.load(), /модуль не загрузился/);
    await assert.rejects(() => loader.load(), /модуль не загрузился/);
    assert.strictEqual(attempts, 2, 'вторая попытка должна снова грузить модуль, а не брать кэш');
  });

  test('IDX-26: успешная загрузка кэшируется — повторная активация не поднимает WASM заново', async () => {
    let imports = 0;
    const loader = new SqliteLoader(
      async () => {
        imports += 1;
        return { default: async () => ({ marker: 'sqlite3' }) };
      },
      () => true,
    );

    const first = await loader.load();
    const second = await loader.load();
    assert.strictEqual(imports, 1, `модуль импортирован ${imports} раз(а) вместо 1`);
    assert.strictEqual(first, second, 'должен вернуться тот же экземпляр sqlite3');
  });

  test('IDX-27: без локальной копии модуля сообщение называет файл и действие', async () => {
    const loader = new SqliteLoader(
      async () => {
        throw new Error('импорт не должен вызываться');
      },
      () => false,
    );

    await assert.rejects(
      () => loader.load(),
      (error: Error) =>
        error.message.includes('Файл индекса не найден') &&
        error.message.includes('npm run compile') &&
        error.message.includes('sqlite'),
    );
  });
});
