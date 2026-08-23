// toolActivity.js — маппинг tool_name → {label, icon} и описание вызова (P0, Этап 3)
// UMD: в WebView — window.TOOL_ACTIVITY, в юнит-тестах — require() возвращает api.
//
// Назначение: дружелюбный рендер tool-calls вместо сырого «🔧 run_terminal {command}».
// Вынесено в отдельный модуль по правилу «чистая логика → отдельный файл + тест».

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TOOL_ACTIVITY = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // tool_name → { label, icon } (AC P0-3.1)
  var TOOL_LABELS = {
    read_file:        { label: 'Чтение файла',    icon: '📖' },
    search_files:     { label: 'Поиск',           icon: '🔍' },
    list_files:       { label: 'Список файлов',   icon: '📂' },
    run_terminal:     { label: 'Команда',         icon: '▶️' },
    write_file:       { label: 'Запись файла',    icon: '📝' },
    replace_in_file:  { label: 'Правка файла',    icon: '✏️' },
    web_fetch:        { label: 'Загрузка страницы', icon: '🌐' },
    ask_user:         { label: 'Вопрос',          icon: '💬' },
    delegate_to_agent:{ label: 'Делегирование',   icon: '🤖' },
  };

  var DEFAULT_ICON = '🔧';

  /** Вернуть {label, icon} для tool_name (fallback — raw name + 🔧). */
  function toolLabel(toolName) {
    var meta = TOOL_LABELS[toolName];
    if (meta) return meta;
    return { label: toolName || 'Инструмент', icon: DEFAULT_ICON };
  }

  /**
   * Краткая сводка аргументов вызова (для отображения в шаге activity-feed).
   * Возвращает строку (пустую, если аргументов нет).
   */
  function toolDetail(toolName, args) {
    if (!args || typeof args !== 'object') return '';
    var a = args;
    switch (toolName) {
      case 'run_terminal':
        return a.command ? String(a.command) : '';
      case 'read_file':
      case 'replace_in_file':
      case 'write_file': {
        var p = a.path || a.filePath || a.file_path;
        return p ? String(p) : '';
      }
      case 'search_files':
        return (a.pattern || a.query) ? String(a.pattern || a.query) : '';
      case 'list_files':
        return a.path ? String(a.path) : '';
      case 'web_fetch':
        return (a.url || a.urls) ? String(a.url || a.urls) : '';
      case 'ask_user':
        return (a.question || a.prompt) ? String(a.question || a.prompt) : '';
      case 'delegate_to_agent':
        return (a.role || a.task) ? String(a.role || a.task) : '';
      default:
        return '';
    }
  }

  /** Полное описание вызова: { label, icon, detail }. */
  function describeToolCall(toolName, args) {
    var meta = toolLabel(toolName);
    return { label: meta.label, icon: meta.icon, detail: toolDetail(toolName, args) };
  }

  return {
    TOOL_LABELS: TOOL_LABELS,
    toolLabel: toolLabel,
    toolDetail: toolDetail,
    describeToolCall: describeToolCall,
  };
}));
