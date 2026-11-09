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

    print(f'[VSIX] ✅ {vsix.name}: версия {manifest.get("version")}, бандл загружается без node_modules')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
