/**
 * Подготовка JS к вставке внутрь `<script>` в разметке webview.
 *
 * Зачем отдельная функция: `</script>` внутри строки или комментария закрывает тег и ломает
 * панель, а проверить это в e2e нельзя — скрипты webview в Extension Host не исполняются.
 */
export function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}
