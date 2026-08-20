// cleanLlmResponse — очистка ответа LLM от markdown-обрамления ```code```
// Общая утилита для Edit Mode и Autocomplete (убирает дублирование).

/**
 * Очистить ответ LLM от markdown-обрамления и лишнего текста.
 * LLM может вернуть код в ```блоках``` — извлекаем только содержимое.
 *
 * @param response - сырой ответ от LLM
 * @returns очищенный код/текст
 */
export function cleanLlmResponse(response: string): string {
  let cleaned = response.trim();

  // Убираем обрамление ```code``` если есть (язык опционален, допускает +/-, например c++/c#)
  const codeBlockRegex = /^```(?:[\w+-]+)?\s*\n?([\s\S]*?)\n?```$/;
  const match = cleaned.match(codeBlockRegex);
  if (match) {
    cleaned = match[1].trim();
  }

  // Убираем одинарные обрамления ``` без указания языка
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.slice(3, -3).trim();
  }

  return cleaned;
}
