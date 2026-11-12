/**
 * Фильтр запусков для панели истории: чистые функции, без DOM.
 *
 * Вынесено из inline-скрипта webview, чтобы фильтр можно было проверить юнит-тестом:
 * логика в разметке — это единственное место, где ошибка не видна ни типам, ни тестам.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HistoryFilters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * @param {Array<{mode?: string, status?: string}>} runs
   * @param {{mode?: string, status?: string}} filter  'all' или пусто — не фильтровать
   */
  function filterRuns(runs, filter) {
    const mode = filter && filter.mode && filter.mode !== 'all' ? filter.mode : null;
    const status = filter && filter.status && filter.status !== 'all' ? filter.status : null;
    if (!mode && !status) return runs.slice();
    return runs.filter(function (run) {
      if (mode && run.mode !== mode) return false;
      if (status && run.status !== status) return false;
      return true;
    });
  }

  /** Текст пустого состояния: отличает «история пуста» от «фильтр ничего не нашёл». */
  function emptyStateText(filter) {
    const active = filter && ((filter.mode && filter.mode !== 'all') || (filter.status && filter.status !== 'all'));
    return active ? 'Нет записей с выбранным фильтром' : 'История запусков пуста';
  }

  /** Подпись к сводке: сколько строк показано при активном фильтре. */
  function filterSuffix(shown, total, filter) {
    const active = filter && ((filter.mode && filter.mode !== 'all') || (filter.status && filter.status !== 'all'));
    return active ? ` · фильтр показал ${shown} из ${total}` : '';
  }

  return { filterRuns, emptyStateText, filterSuffix };
});
