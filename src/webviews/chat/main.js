// main.js — фронтенд чата для WebView
// Запускается в контексте VS Code WebView после загрузки marked
// Обрабатывает postMessage от extension, рендерит markdown, стриминг

(function () {
  'use strict';

  // ---------- State ----------
  /** Флаг — идёт ли сейчас стриминг ответа */
  let isStreaming = false;

  /** Контейнер для сообщений */
  const messagesContainer = document.getElementById('messages-container');

  /** Поле ввода */
  const messageInput = document.getElementById('message-input');

  /** Кнопка отправки */
  const sendButton = document.getElementById('btn-send');

  /** Кнопка очистки истории */
  const clearButton = document.getElementById('btn-clear');

  /** Кнопка отмены запроса */
  const cancelButton = document.getElementById('btn-cancel');

  /** Индикатор стриминга */
  const streamingIndicator = document.getElementById('streaming-indicator');

  /** Приветственное сообщение */
  const welcomeMessage = document.getElementById('welcome-message');

  /** Референс на последний блок сообщения ассистента для стриминга */
  let lastAssistantMessageEl = null;

  /** Референс на content-элемент последнего сообщения ассистента */
  let lastAssistantContentEl = null;

  // ---------- Utilities ----------

  /**
   * Экранировать HTML-спецсимволы, чтобы избежать XSS.
   * @param {string} str - строка для экранирования
   * @returns {string} экранированная строка
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Простая подсветка синтаксиса для блоков кода.
   * Поддерживает базовые языки: js, ts, python, html, css, json, bash, sql.
   *
   * @param {string} code - исходный код
   * @param {string} lang - язык (из маркдауна ```lang)
   * @returns {string} HTML с подсветкой
   */
  function highlightCode(code, lang) {
    const escaped = escapeHtml(code);
    const langLower = (lang || '').toLowerCase();

    // Карта подсветки для разных языков
    const rules = {
      js: highlightJavaScript,
      javascript: highlightJavaScript,
      ts: highlightTypeScript,
      typescript: highlightTypeScript,
      python: highlightPython,
      py: highlightPython,
      html: highlightHtml,
      css: highlightCss,
      json: highlightJson,
      bash: highlightBash,
      sh: highlightBash,
      shell: highlightBash,
      sql: highlightSql,
    };

    const highlighter = rules[langLower];
    if (highlighter) {
      return highlighter(escaped);
    }

    // Если язык неизвестен — возвращаем просто экранированный код
    return `<pre><code>${escaped}</code></pre>`;
  }

  /**
   * Подсветка JavaScript/TypeScript.
   */
  function highlightJavaScript(code) {
    return highlightByRules(code, [
      { pattern: /(\/\/.*$)/gm, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, replace: '<span class="hljs-string">$1</span>' },
      { pattern: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|async|await|import|export|from|class|extends|typeof|instanceof|try|catch|throw|finally|in|of|yield|static|get|set)\b/g, replace: '<span class="hljs-keyword">$1</span>' },
      { pattern: /\b(\d+\.?\d*)\b/g, replace: '<span class="hljs-number">$1</span>' },
    ]);
  }

  function highlightTypeScript(code) {
    return highlightByRules(code, [
      { pattern: /(\/\/.*$)/gm, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, replace: '<span class="hljs-string">$1</span>' },
      { pattern: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|async|await|import|export|from|class|extends|typeof|instanceof|try|catch|throw|finally|in|of|yield|static|get|set|interface|type|enum|implements|abstract|private|protected|public|readonly)\b/g, replace: '<span class="hljs-keyword">$1</span>' },
      { pattern: /\b(\d+\.?\d*)\b/g, replace: '<span class="hljs-number">$1</span>' },
      { pattern: /(: string|: number|: boolean|: void|: any|: never|: unknown|: undefined|null|:\[\]|: Record<|: Partial<|: Pick<)/g, replace: '<span class="hljs-type">$1</span>' },
    ]);
  }

  function highlightPython(code) {
    return highlightByRules(code, [
      { pattern: /(#.*$)/gm, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|""".*?"""|'''.*?''')/gs, replace: '<span class="hljs-string">$1</span>' },
      { pattern: /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|raise|with|as|pass|break|continue|lambda|yield|async|await|self|True|False|None|in|not|and|or|is|del|print|range|len)\b/g, replace: '<span class="hljs-keyword">$1</span>' },
      { pattern: /\b(\d+\.?\d*)\b/g, replace: '<span class="hljs-number">$1</span>' },
    ]);
  }

  function highlightHtml(code) {
    return highlightByRules(code, [
      { pattern: /(&lt;!--[\s\S]*?--&gt;)/g, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /(&lt;\/?)([\w-]+)/g, replace: '$1<span class="hljs-keyword">$2</span>' },
      { pattern: /(\s)([\w-]+)(=)(&quot;|&#39;)/g, replace: '$1<span class="hljs-attr">$2</span>$3$4' },
      { pattern: /(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g, replace: '<span class="hljs-string">$1</span>' },
    ]);
  }

  function highlightCss(code) {
    return highlightByRules(code, [
      { pattern: /(\/\*[\s\S]*?\*\/)/g, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /([\w-]+)(\s*:)/g, replace: '<span class="hljs-attr">$1</span>$2' },
      { pattern: /(#[\w-]+|\.\w+)/g, replace: '<span class="hljs-keyword">$1</span>' },
      { pattern: /(\d+\.?\d*)(px|em|rem|vh|vw|%|s|ms)/g, replace: '<span class="hljs-number">$1</span><span class="hljs-string">$2</span>' },
      { pattern: /("(?:[^"\\]|\\.)*")/g, replace: '<span class="hljs-string">$1</span>' },
    ]);
  }

  function highlightJson(code) {
    return highlightByRules(code, [
      { pattern: /("(?:[^"\\]|\\.)*")(\s*:)/g, replace: '<span class="hljs-attr">$1</span>$2' },
      { pattern: /("(?:[^"\\]|\\.)*")/g, replace: '<span class="hljs-string">$1</span>' },
      { pattern: /\b(true|false|null)\b/g, replace: '<span class="hljs-keyword">$1</span>' },
      { pattern: /\b(\d+\.?\d*)\b/g, replace: '<span class="hljs-number">$1</span>' },
    ]);
  }

  function highlightBash(code) {
    return highlightByRules(code, [
      { pattern: /(#.*$)/gm, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, replace: '<span class="hljs-string">$1</span>' },
      { pattern: /\b(echo|cd|ls|rm|mv|cp|mkdir|touch|cat|grep|find|chmod|chown|npm|node|git|docker|curl|wget|sudo|apt|yum|pip|npx|export|source|exit)\b/g, replace: '<span class="hljs-keyword">$1</span>' },
    ]);
  }

  function highlightSql(code) {
    return highlightByRules(code, [
      { pattern: /(--.*$|#.*$)/gm, replace: '<span class="hljs-comment">$1</span>' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, replace: '<span class="hljs-string">$1</span>' },
      { pattern: /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|SET|VALUES|INTO|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|EXISTS|CASE|WHEN|THEN|ELSE|END|NULL|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|CASCADE)\b/g, replace: '<span class="hljs-keyword">$1</span>' },
      { pattern: /\b(\d+\.?\d*)\b/g, replace: '<span class="hljs-number">$1</span>' },
    ]);
  }

  /**
   * Применить набор правил подсветки к коду.
   * @param {string} code - экранированный HTML код
   * @param {Array<{pattern: RegExp, replace: string}>} rulesList - правила замены
   * @returns {string} HTML с подсветкой
   */
  function highlightByRules(code, rulesList) {
    let result = code;
    for (const rule of rulesList) {
      result = result.replace(rule.pattern, rule.replace);
    }
    return `<pre><code>${result}</code></pre>`;
  }

  /**
   * Рендерить markdown-текст в HTML с подсветкой кода.
   * Использует marked для парсинга, затем заменяет блоки кода подсвеченными.
   *
   * @param {string} text - markdown-текст
   * @returns {string} HTML
   */
  function renderMarkdown(text) {
    if (!text) return '';

    // Используем marked для парсинга markdown в HTML
    const rawHtml = marked.parse(text, {
      breaks: true,
      gfm: true,
    });

    // После marked, заменяем блоки кода на подсвеченные версии
    // Блоки от marked выглядят как <pre><code class="language-xxx">code</code></pre>
    const highlightedHtml = rawHtml.replace(
      /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
      (match, lang, code) => {
        const decoded = decodeHtmlEntities(code);
        return highlightCode(decoded, lang);
      }
    );

    return highlightedHtml;
  }

  /**
   * Декодировать HTML-сущности (marked экранирует их).
   */
  function decodeHtmlEntities(str) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
  }

  // ---------- Message Rendering ----------

  /**
   * Создать DOM-элемент для сообщения.
   *
   * @param {string} role - 'user' | 'assistant' | 'error'
   * @param {string} content - текст сообщения (markdown для assistant)
   * @param {boolean} isStreaming - флаг стриминга (для добавления курсора)
   * @returns {HTMLElement} элемент сообщения
   */
  function createMessageElement(role, content, streaming = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;

    // Роль (лейбл)
    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role === 'user' ? 'Ты' : (role === 'error' ? 'Ошибка' : 'Ассистент');
    messageDiv.appendChild(roleLabel);

    // Content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'user') {
      // Пользовательский текст — обычный текст (не markdown)
      contentDiv.textContent = content;
    } else if (role === 'error') {
      contentDiv.textContent = content;
    } else {
      // Ассистент — рендерим markdown
      contentDiv.innerHTML = renderMarkdown(content);
    }

    messageDiv.appendChild(contentDiv);

    if (streaming) {
      messageDiv.classList.add('streaming');
    }

    return messageDiv;
  }

  /**
   * Добавить сообщение в контейнер.
   *
   * @param {string} role - 'user' | 'assistant' | 'error'
   * @param {string} content - текст
   * @param {boolean} streaming - является ли это стриминг-сообщением
   * @returns {HTMLElement} созданный элемент
   */
  function addMessage(role, content, streaming = false) {
    // Если есть приветственное сообщение — удаляем его при первом реальном сообщении
    if (welcomeMessage && !welcomeMessage.classList.contains('hidden')) {
      welcomeMessage.classList.add('hidden');
    }

    const el = createMessageElement(role, content, streaming);
    messagesContainer.appendChild(el);

    // Если стриминг — сохраняем ссылку на последний элемент
    if (streaming) {
      lastAssistantMessageEl = el;
      lastAssistantContentEl = el.querySelector('.message-content');
    } else {
      lastAssistantMessageEl = null;
      lastAssistantContentEl = null;
    }

    // Скроллим вниз
    scrollToBottom();

    return el;
  }

  /**
   * Добавить токен (чанк) к текущему стриминг-сообщению.
   *
   * @param {string} chunk - текст токена
   */
  function appendStreamChunk(chunk) {
    if (!lastAssistantContentEl) {
      // Если нет активного стриминг-сообщения — создаём новое
      addMessage('assistant', chunk, true);
      return;
    }

    // Добавляем текст к текущему содержимому
    const currentHtml = lastAssistantContentEl.innerHTML;
    // Берём текст без последнего мигающего курсора
    const cleanHtml = currentHtml.replace(/▊$/, '');
    lastAssistantContentEl.innerHTML = cleanHtml + escapeHtml(chunk) + '▊';

    // Скроллим
    scrollToBottom();
  }

  /**
   * Завершить стриминг — убрать курсор и перерендерить markdown.
   */
  function finishStreaming() {
    if (lastAssistantContentEl) {
      // Убираем мигающий курсор
      const currentHtml = lastAssistantContentEl.innerHTML.replace(/▊$/, '');
      // Перерендерим весь текст как markdown
      // Нужно извлечь сырой текст из HTML
      const rawText = extractTextFromHtml(currentHtml);
      lastAssistantContentEl.innerHTML = renderMarkdown(rawText);
    }

    if (lastAssistantMessageEl) {
      lastAssistantMessageEl.classList.remove('streaming');
    }

    isStreaming = false;
    lastAssistantMessageEl = null;
    lastAssistantContentEl = null;

    // Прячем индикатор стриминга
    streamingIndicator.classList.add('hidden');

    // Включаем кнопку отправки и поле ввода
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }

  /**
   * Извлечь текст из HTML, удаляя теги.
   */
  function extractTextFromHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  }

  /**
   * Прокрутить контейнер сообщений вниз.
   */
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // ---------- WebView <-> Extension Communication ----------

  /**
   * Отправить сообщение в extension.
   *
   * @param {object} message - объект сообщения
   */
  function postMessage(message) {
    vscode.postMessage(message);
  }

  /**
   * Отправить сообщение пользователя в extension.
   */
  function sendUserMessage() {
    const text = messageInput.value.trim();
    if (!text || isStreaming) return;

    messageInput.value = '';
    addMessage('user', text);

    const mode = document.getElementById('mode-select')?.value || 'chat';
    const provider = document.getElementById('provider-select')?.value || '';
    const model = document.getElementById('model-select')?.value || '';

    postMessage({ type: 'sendMessage', text, mode, provider, model });

    streamingIndicator.classList.remove('hidden');
    sendButton.disabled = true;
    messageInput.disabled = true;
    isStreaming = true;
  }

  /**
   * Обработчик сообщений от extension.
   *
   * @param {object} event - событие с данными от extension
   */
  function handleMessage(event) {
    const message = event.data;

    switch (message.type) {
      case 'userMessage':
        // Сообщение уже добавлено локально в sendUserMessage(), не дублируем
        break;

      case 'streamChunk':
        // Токен стрима
        appendStreamChunk(message.text);
        break;

      case 'done':
        // Стрим завершён
        finishStreaming();
        break;

      case 'cancelled':
        // Запрос отменён пользователем
        finishStreaming();
        // Добавляем уведомление об отмене
        addMessage('assistant', '_Запрос отменён._');
        break;

      case 'error':
        // Ошибка
        finishStreaming();
        addMessage('error', message.text);
        break;

      case 'history':
        // Восстановление истории (при загрузке или переключении вкладки)
        restoreHistory(message.messages);
        break;

      case 'sessionList':
        updateSessionList(message.sessions, message.activeId);
        break;

      case 'providerList':
        updateProviderList(message.providers, message.defaultProvider);
        break;

      default:
        console.warn('[WebView] Неизвестный тип сообщения:', message.type);
    }
  }

  /**
   * Восстановить историю сообщений в WebView.
   *
   * @param {Array<{role: string, content: string}>} messages - сообщения из истории
   */
  function restoreHistory(messages) {
    if (!messages || messages.length === 0) return;

    // Очищаем все сообщения, кроме приветственного
    const welcome = document.getElementById('welcome-message');
    messagesContainer.innerHTML = '';
    if (welcome) {
      messagesContainer.appendChild(welcome);
      welcome.classList.remove('hidden');
    }

    // Добавляем каждое сообщение
    for (const msg of messages) {
      addMessage(msg.role, msg.content);
    }
  }

  // ---------- Session Management ----------

  const sessionSelect = document.getElementById('session-select');
  const btnNewSession = document.getElementById('btn-new-session');

  function updateSessionList(sessions, activeId) {
    if (!sessionSelect || !sessions) return;
    sessionSelect.innerHTML = '';
    for (const s of sessions) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name + (s.messageCount > 0 ? ` (${s.messageCount})` : '');
      if (s.id === activeId) opt.selected = true;
      sessionSelect.appendChild(opt);
    }
  }

  if (sessionSelect) {
    sessionSelect.addEventListener('change', () => {
      postMessage({ type: 'switchSession', sessionId: sessionSelect.value });
    });
  }

  if (btnNewSession) {
    btnNewSession.addEventListener('click', () => {
      postMessage({ type: 'newSession' });
    });
  }

  // ---------- Provider & Model Management ----------

  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  let providersData = {};

  function updateProviderList(providers, defaultProvider) {
    if (!providerSelect) return;
    providersData = providers;
    providerSelect.innerHTML = '';
    for (const [name, cfg] of Object.entries(providers)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === defaultProvider) opt.selected = true;
      providerSelect.appendChild(opt);
    }
    // Заполняем модели для выбранного провайдера
    updateModelList();
  }

  function updateModelList() {
    if (!modelSelect || !providerSelect) return;
    const provider = providerSelect.value;
    const models = providersData[provider]?.models || [];
    modelSelect.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSelect.appendChild(opt);
    }
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', updateModelList);
  }

  // ---------- Event Listeners ----------

  // Устанавливаем обработчик сообщений от extension
  window.addEventListener('message', handleMessage);

  // Отправка сообщения по Enter (Shift+Enter — новая строка)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });

  // Отправка по кнопке
  sendButton.addEventListener('click', sendUserMessage);

  // Очистка истории
  clearButton.addEventListener('click', () => {
    postMessage({ type: 'clearHistory' });
    // Восстанавливаем приветственное сообщение
    const welcome = document.getElementById('welcome-message');
    messagesContainer.innerHTML = '';
    if (welcome) {
      messagesContainer.appendChild(welcome);
      welcome.classList.remove('hidden');
    }
  });

  // Отмена запроса
  cancelButton.addEventListener('click', () => {
    postMessage({ type: 'cancelRequest' });
  });

  // Авто-изменение высоты textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
  });

  // ---------- Initialize ----------

  // Отправляем сообщение о готовности WebView
  // Используем setTimeout, чтобы VS Code успел установить обработчик
  setTimeout(() => {
    postMessage({ type: 'ready' });
  }, 100);

  // Получаем API vscode для postMessage
  const vscode = acquireVsCodeApi();

})();