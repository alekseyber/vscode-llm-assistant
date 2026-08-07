# План: web_fetch — чтение веб-страниц агентом

## Суть

Агент получает инструмент `web_fetch(url, selector?)` для чтения содержимого веб-страниц. Использует нативный Node.js fetch — без внешних зависимостей.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Успешный fetch | Извлечь текст из `<body>`, обрезать до 15000 символов |
| CSS-селектор передан | Извлечь текст только из элемента по селектору |
| Ошибка сети | Вернуть `Ошибка: <сообщение>` |
| HTTP 4xx/5xx | Вернуть `HTTP <код>: <статус>` |
| Пустой ответ | Вернуть `(пустая страница)` |
| Страница без body | Вернуть текст всей страницы |
| Не-HTML контент (JSON/текст) | Вернуть как есть |

## AC

| ID | Критерий |
|----|----------|
| WF-1 | `web_fetch` доступен в ChatAgentTools (getToolSchemas + getTool) |
| WF-2 | HTML → текст: удалены `<script>`, `<style>`, `<nav>`, `<footer>` |
| WF-3 | Ответ ≤ 15000 символов (обрезается без предупреждения) |
| WF-4 | Опциональный селектор: `web_fetch(url, "#content")` → только этот блок |
| WF-5 | Требует подтверждения: `isConfirmationRequired('web_fetch') = true` |
| WF-6 | Тул доступен в Apply Mode через ToolDefinitions (полный аналог) |

## Этапы реализации

### WF.1 — ChatAgentTools: новый инструмент (20 мин)

**Файл:** `src/modes/chat/ChatAgentTools.ts`

```typescript
// Перед CHAT_AGENT_TOOLS добавить:

/**
 * Извлекает текст из HTML: удаляет script, style, nav, footer.
 * Если selector передан — только содержимое элемента.
 */
function extractTextFromHtml(html: string, selector?: string): string {
  if (selector) {
    const match = html.match(new RegExp(
      `<[^>]*\\bclass\\s*=\\s*["']?${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?[^>]*>` +
      `([\\s\\S]*?)<\\/[^>]+>`,
      'i'
    ));
    if (match) {
      html = match[1] || html;
    }
  }
  // Удаляем неконтентные теги
  return html
    .replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '')
    .replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '')
    .replace(/<nav[^>]*>[\\s\\S]*?<\\/nav>/gi, '')
    .replace(/<footer[^>]*>[\\s\\S]*?<\\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')         // убрать все HTML-теги
    .replace(/&[a-z]+;/gi, ' ')       // убрать HTML-entities
    .replace(/\\s{2,}/g, '\\n')       // схлопнуть пробелы
    .trim();
}

const webFetchTool: ChatTool = {
  name: 'web_fetch',
  description: 'Читает содержимое веб-страницы. Возвращает текст (max 15000 символов).',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL страницы для чтения',
      },
      selector: {
        type: 'string',
        description: 'CSS-селектор для извлечения конкретного блока (опционально)',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    try {
      const response = await fetch(args.url as string, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'VS Code LLM Assistant/1.0' },
      });
      if (!response.ok) {
        return `HTTP ${response.status}: ${response.statusText}`;
      }
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      // Если не HTML — возвращаем как есть
      if (!contentType.includes('html')) {
        return text.slice(0, 15000) || '(пустая страница)';
      }
      const bodyMatch = text.match(/<body[^>]*>([\\s\\S]*?)<\\/body>/i);
      const html = bodyMatch ? bodyMatch[1] : text;
      const result = extractTextFromHtml(html, args.selector as string | undefined);
      return result.slice(0, 15000) || '(пустая страница)';
    } catch (e: any) {
      return `Ошибка: ${e.message}`;
    }
  },
};
```

- Добавить `webFetchTool` в `CHAT_AGENT_TOOLS`
- `isConfirmationRequired` уже вернёт `true` (all-tools режим при отсутствии allow-list)

### WF.2 — ToolDefinitions: аналог для Apply Mode (10 мин)

**Файл:** `src/modes/apply/ToolDefinitions.ts`

Тот же код `extractTextFromHtml` + tool-определение. Копипаста или вынос в shared.

### WF.3 — Тесты (10 мин)

**Файл:** `test/suite/chatAgentTools.test.ts`

Добавить тесты:
- `web_fetch` возвращает текст из HTML
- `web_fetch` обрезает до 15000
- `web_fetch` обрабатывает ошибку сети (мок fetch)
- `web_fetch` с селектором возвращает только нужный блок

### WF.4 — Spec обновление

**Файлы:** `specs/ChatAgentTools.md`, `specs/ToolDefinitions.md`, `specs/ARCHITECTURE.md`

Добавить инструмент в таблицы, контракты.

## Гейты

| Gate | Что проверять |
|------|---------------|
| G1 | `npm run compile` — 0 ошибок |
| G2 | `npm run test:mocked` — все тесты проходят |
| G3 | `node scripts/spec-validate.js` — 0 ошибок |
| G4 | Проверка вручную: `«прочитай https://example.com»` в чате |

## Оценка

**~40 минут** (с тестами и spec)
