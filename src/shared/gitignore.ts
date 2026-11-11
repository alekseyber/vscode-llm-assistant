// Правила .gitignore — без зависимости от VS Code API.
//
// Вынесено из ToolDefinitions, потому что то же поведение нужно индексатору (P8):
// импорт ToolDefinitions тянет `vscode`, и модуль нельзя использовать в обычном Node
// (стенд, скрипты замеров).

/** Разобрать .gitignore в список простых правил (без полноценного git-синтаксиса). */
export function parseGitignore(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => line.replace(/^\//, '').replace(/\/$/, ''));
}

/** Попадает ли путь под правила .gitignore (по префиксу каталога или шаблону с *). */
export function isIgnored(relativePath: string, rules: readonly string[]): boolean {
  const p = relativePath.replace(/\\/g, '/');
  for (const rule of rules) {
    if (rule.includes('*')) {
      // Шаблон без слэша (*.log) действует на любом уровне вложенности, как в git:
      // иначе правило из корневого .gitignore не ловило src/deep/file.log
      const anchored = rule.includes('/');
      const body = rule
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      const rx = new RegExp((anchored ? '^' : '(^|.*/)') + body + '($|/)');
      if (rx.test(p)) return true;
      continue;
    }
    if (p === rule || p.startsWith(rule + '/') || p.includes('/' + rule + '/')) return true;
  }
  return false;
}
