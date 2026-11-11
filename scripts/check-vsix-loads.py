#!/usr/bin/env python3
"""Проверка, что собранный .vsix реально загружается — то есть уедет работоспособным.

Зачем: 09.11 расширение «ставилось», но не активировалось. В пакет попал dist, собранный
tsc (пофайловые модули), а node_modules в VSIX не кладутся: `require("openai")` падал
при загрузке модуля. Юнит-тесты и e2e этого не видели — они гоняют `out/` в репозитории,
где node_modules есть.

Скрипт распаковывает VSIX во временный каталог и требует `dist/extension.js` оттуда,
подставив заглушку `vscode`. Любой внешний пакет, которого нет в пакете, даёт падение.

Использование: python3 scripts/check-vsix-loads.py <путь.vsix>
Код выхода: 1 — бандл в пакете не загружается.
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import zipfile

NODE_CHECK = r'''
const Module = require('module');
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return new Proxy({}, { get: () => new Proxy(function () {}, { get: () => () => undefined }) });
  }
  return original.call(this, request, parent, isMain);
};
try {
  const bundle = require('./dist/extension.js');
  if (typeof bundle.activate !== 'function') {
    console.error('нет exports.activate');
    process.exit(2);
  }
  console.log('OK');
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(3);
}
'''


# Проверка индекса: в VSIX нет node_modules, поэтому sqlite-wasm должен лежать в dist/sqlite
# и реально инициализироваться с FTS5. Без этого карта поиска просто не поднимется.
SQLITE_CHECK = r'''
(async () => {
  const { pathToFileURL } = require('url');
  const path = require('path');
  const file = path.join(process.cwd(), 'dist', 'sqlite', 'node.mjs');
  const mod = await import(pathToFileURL(file).href);
  const init = typeof mod.default === 'function' ? mod.default : mod;
  const sqlite3 = await init();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec("CREATE VIRTUAL TABLE t USING fts5(x); INSERT INTO t VALUES('ok');");
  const rows = db.exec({ sql: 'SELECT count(*) FROM t WHERE t MATCH ?', bind: ['ok'], rowMode: 'array', returnValue: 'resultRows' });
  if (!rows || Number(rows[0][0]) !== 1) {
    console.error('FTS5 не работает из распакованного пакета');
    process.exit(4);
  }
  console.log('OK');
})().catch((error) => { console.error(error && error.message ? error.message : String(error)); process.exit(5); });
'''


script_dir = pathlib.Path(__file__).resolve().parent


def main() -> int:
    if len(sys.argv) == 2:
        vsix = pathlib.Path(sys.argv[1])
    else:
        # Без аргумента берём самый свежий пакет в корне проекта
        candidates = sorted(
            pathlib.Path(__file__).resolve().parent.parent.glob('*.vsix'),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            print('использование: check-vsix-loads.py <путь.vsix> (в корне пакетов нет)', file=sys.stderr)
            return 2
        vsix = candidates[0]
    if not vsix.exists():
        print(f'[VSIX] ❌ нет файла {vsix}', file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(vsix) as archive:
            archive.extractall(tmp)

        extension_dir = pathlib.Path(tmp) / 'extension'
        if not (extension_dir / 'dist' / 'extension.js').exists():
            print('[VSIX] ❌ в пакете нет dist/extension.js', file=sys.stderr)
            return 1

        # Тестовая сборка и спеки в пакете — мёртвый груз (было 239 файлов вместо 29)
        dead = [
            str(path.relative_to(extension_dir)) for path in extension_dir.rglob('*')
            if path.is_file() and (path.relative_to(extension_dir).parts[0] in {'out', 'test', 'specs', 'scripts', 'reports'})
        ]
        if dead:
            print(f'[VSIX] ❌ в пакет попало {len(dead)} файлов тестов/спек (например {dead[0]})', file=sys.stderr)
            print('[VSIX] Проверьте .vscodeignore: out/, test/, specs/, scripts/, reports/ не должны уезжать.', file=sys.stderr)
            return 1

        # Файлы индекса и прочий мусор стендов не должны уезжать в пакет
        junk = [str(path.relative_to(extension_dir)) for path in extension_dir.rglob('*')
                if path.is_file() and (path.suffix in {'.sqlite', '.db'} or path.name.endswith('.sqlite-journal'))]
        if junk:
            print(f'[VSIX] ❌ в пакет попали файлы индекса/базы: {junk[:3]}', file=sys.stderr)
            print('[VSIX] Добавьте их в .vscodeignore и пересоберите пакет.', file=sys.stderr)
            return 1

        # Лишние .js рядом с бандлом — это вывод tsc, попавший в пакет
        strays = [
            path.name for path in (extension_dir / 'dist').rglob('*.js')
            if path.name != 'extension.js'
        ]
        if strays:
            print(f'[VSIX] ❌ в dist/ кроме бандла лежат {len(strays)} файлов (вывод tsc?):', file=sys.stderr)
            print('  ' + ', '.join(strays[:5]), file=sys.stderr)
            print('[VSIX] Соберите webpack-бандл: npm run compile (output.clean очищает dist).', file=sys.stderr)
            return 1

        # Индекс (P8): модуль и wasm должны быть в пакете, иначе поиск молча деградирует
        wasm = extension_dir / 'dist' / 'sqlite' / 'sqlite3.wasm'
        sqlite_entry = extension_dir / 'dist' / 'sqlite' / 'node.mjs'
        if not wasm.exists() or not sqlite_entry.exists():
            print('[VSIX] ❌ в пакете нет dist/sqlite (node.mjs + sqlite3.wasm): локальный индекс не поднимется',
                  file=sys.stderr)
            print('[VSIX] Проверьте scripts/copy-sqlite-assets.js в npm run compile и .vscodeignore.',
                  file=sys.stderr)
            return 1

        # 1) модуль и wasm живы сами по себе (FTS5)
        sqlite_result = subprocess.run(
            ['node', '-e', SQLITE_CHECK],
            cwd=extension_dir,
            capture_output=True,
            text=True,
        )
        if sqlite_result.returncode != 0:
            print('[VSIX] ❌ sqlite-wasm из пакета не инициализируется:',
                  file=sys.stderr)
            print(sqlite_result.stderr.strip() or sqlite_result.stdout.strip(), file=sys.stderr)
            return 1

        # 2) и главное — бандл реально поднимает индекс из этого пакета: проверяем не
        # «файлы лежат», а фактическое создание индекса при активации (нет node_modules)
        smoke = subprocess.run(
            ['node', str(script_dir / 'smoke-vsix-index.js'), str(extension_dir)],
            cwd=extension_dir,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if smoke.returncode != 0:
            print('[VSIX] ❌ активация из пакета не создаёт индекс:', file=sys.stderr)
            print((smoke.stderr or smoke.stdout).strip()[-1500:], file=sys.stderr)
            return 1

        manifest = json.loads((extension_dir / 'package.json').read_text(encoding='utf-8'))
        main_entry = manifest.get('main', './dist/extension.js').lstrip('./')
        if main_entry != 'dist/extension.js':
            print(f'[VSIX] ℹ️ main указывает на {main_entry}', file=sys.stderr)

        result = subprocess.run(
            ['node', '-e', NODE_CHECK],
            cwd=extension_dir,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print('[VSIX] ❌ бандл в пакете не загружается:', file=sys.stderr)
            print(result.stderr.strip() or result.stdout.strip(), file=sys.stderr)
            print('[VSIX] Обычно это внешний require пакета, которого нет в VSIX '
                  '(node_modules не пакуются): соберите webpack-бандл через npm run compile.',
                  file=sys.stderr)
            return 1

    print(f'[VSIX] ✅ {vsix.name}: версия {manifest.get("version")}, бандл загружается без node_modules, '
          f'sqlite-wasm с FTS5 поднимается из пакета, бандл создаёт индекс при активации')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
