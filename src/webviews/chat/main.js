// main.js — фронтенд чата для WebView
// Запускается в контексте VS Code WebView после загрузки marked
// Обрабатывает postMessage от extension, рендерит markdown, стриминг

(function () {
  'use strict';

  // ---------- Token Usage ----------

  // Максимальное количество токенов контекста (обновляется из настроек)
  let maxContextTokens = 4096;

  // Цены за 1M токенов (примерные)
  const MODEL_PRICES = {
    'deepseek-chat': { input: 0.14, output: 0.28 },
    'deepseek-v4-pro': { input: 0.435, output: 0.87 },
    'deepseek-v4-flash': { input: 0.14, output: 0.28 },
    'Qwen/Qwen3-VL-32B-Instruct': { input: 0.20, output: 0.60 },
    'Qwen/Qwen3-VL-8B-Instruct': { input: 0.18, output: 0.68 },
    'gpt-4o': { input: 2.50, output: 10.00 },
  };

  function showTokenUsage(msg) {
    const price = MODEL_PRICES[msg.model] || { input: 0.5, output: 1.0 };
    const cost = ((msg.inputTokens / 1_000_000) * price.input + (msg.outputTokens / 1_000_000) * price.output);

    // Обновляем индикатор в шапке
    const tokenText = document.querySelector('.token-text');
    const tokenFill = document.querySelector('.token-bar-fill');
    const tokenLimit = document.querySelector('.token-limit');

    if (tokenText && tokenFill && tokenLimit) {
      tokenText.textContent = `📊 ${msg.inputTokens}+${msg.outputTokens} ≈ $${cost.toFixed(4)}`;
      const rawPct = (msg.inputTokens / maxContextTokens) * 100;
      const pct = Math.min(100, rawPct);
      tokenFill.style.width = pct + '%';
      tokenFill.className = 'token-bar-fill' + (rawPct > 100 ? ' overflow' : rawPct > 80 ? ' warning' : '');
      tokenLimit.textContent = `${msg.inputTokens}/${maxContextTokens}`;
    }

    // Бейдж в чате (сохраняем)
    const badge = document.createElement('div');
    badge.className = 'token-badge';
    badge.innerHTML = `📊 ${msg.inputTokens}+${msg.outputTokens} токенов ≈ $${cost.toFixed(4)}`;
    messagesContainer.appendChild(badge);

    scrollToBottom();
  }
  /** Показать статус ретрая в WebView */
  function showRetryStatus(msg) {
    const indicator = document.getElementById('streaming-indicator');
    if (indicator) {
      indicator.classList.remove('hidden');
      indicator.querySelector('.loading-dots').textContent = `⚠️ ${msg.text}`;
      indicator.style.background = '#fce4c9';
    }
  }
  /** Сбросить индикатор ретрая (после успеха или начала нового запроса) */
  function hideRetryStatus() {
    const indicator = document.getElementById('streaming-indicator');
    if (indicator) {
      indicator.querySelector('.loading-dots').textContent = 'LLM печатает';
      indicator.style.background = '';
      indicator.classList.add('hidden');
    }
  }
  /** Флаг — идёт ли сейчас стриминг ответа */
  let isStreaming = false;
  let currentSessionId = '';
  const runningSessions = new Set();

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
    // Плейсхолдеры защищают уже-выделенные спаны от повторного матча последующими правилами:
    // иначе number/keyword попадают внутрь string-спана → вложенные спаны (<span><span>).
    const placeholders = [];
    for (const rule of rulesList) {
      result = result.replace(rule.pattern, (...args) => {
        const groups = args.slice(1, -2); // capture-группы (без match/offset/string)
        const replaced = rule.replace.replace(/\$(\d)/g, (_, n) => groups[Number(n) - 1] ?? '');
        // Префикс 'X' не даёт number-правилу (\b\d) сматчить цифру индекса
        const ph = '\u0000X' + placeholders.length + '\u0000';
        placeholders.push(replaced);
        return ph;
      });
    }
    // Восстанавливаем плейсхолдеры (уникальные по индексу)
    for (let i = 0; i < placeholders.length; i++) {
      result = result.split('\u0000X' + i + '\u0000').join(placeholders[i]);
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

  /** Сырой текст финального ответа (для избежания разрывов markdown) */
  let streamingRawText = '';

  /** DOM-элементы для структурированного хода выполнения агента */
  let streamingActivityEl = null;   // <div class="agent-activity">
  let streamingAnswerEl = null;     // <div class="streaming-answer">
  let currentActivityStep = null;   // текущий <details> шаг

  /** Создать (при необходимости) контейнеры активности и ответа */
  function ensureStreamingEls() {
    if (!lastAssistantContentEl) {
      hideRetryStatus();
      addMessage('assistant', '', true);
      if (!lastAssistantContentEl) return false;
    }
    if (!streamingActivityEl) {
      streamingActivityEl = document.createElement('div');
      streamingActivityEl.className = 'agent-activity';
      lastAssistantContentEl.appendChild(streamingActivityEl);
    }
    if (!streamingAnswerEl) {
      streamingAnswerEl = document.createElement('div');
      streamingAnswerEl.className = 'streaming-answer';
      lastAssistantContentEl.appendChild(streamingAnswerEl);
    }
    return true;
  }

  /** Новый шаг: заголовок «🔧 toolName» (сворачиваемый details) */
  function appendActivityStep(toolName) {
    if (!ensureStreamingEls()) return;
    const step = document.createElement('details');
    step.className = 'activity-step';
    const summary = document.createElement('summary');
    summary.className = 'activity-step-summary';
    summary.innerHTML = `<span class="activity-icon">🔧</span><span class="activity-tool">${escapeHtml(toolName)}</span><span class="activity-status">…</span>`;
    step.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'activity-step-body';
    step.appendChild(body);
    streamingActivityEl.appendChild(step);
    currentActivityStep = step;
    scrollToBottom();
  }

  /** Заполнить результат текущего шага (сворачиваемое тело) */
  function appendActivityResult(text) {
    if (!currentActivityStep) return;
    const body = currentActivityStep.querySelector('.activity-step-body');
    const status = currentActivityStep.querySelector('.activity-status');
    if (body) body.textContent = text || '';
    if (status) status.textContent = '✓';
    // Короткий результат раскрываем сразу, длинный — оставляем свёрнутым
    if (text && text.length < 200) currentActivityStep.open = true;
    scrollToBottom();
  }

  /** Заметка (например, запрос подтверждения) */
  function appendActivityNote(text) {
    if (!ensureStreamingEls()) return;
    const note = document.createElement('div');
    note.className = 'activity-note';
    note.textContent = text;
    streamingActivityEl.appendChild(note);
    scrollToBottom();
  }

  /** Обработчик структурированного хода выполнения */
  function handleToolActivity(activity) {
    if (!activity) return;
    if (activity.kind === 'start') appendActivityStep(activity.toolName);
    else if (activity.kind === 'result') appendActivityResult(activity.text);
    else if (activity.kind === 'note') appendActivityNote(activity.text);
  }

  /**
   * Добавить токен (чанк) финального ответа.
   */
  function appendStreamChunk(chunk) {
    if (!ensureStreamingEls()) return;
    streamingRawText += chunk;
    streamingAnswerEl.textContent = streamingRawText + '▊';
    scrollToBottom();
  }

  /** Сбросить состояние стрима (флаги, указатели, индикатор, поле ввода) */
  function resetStreamingState() {
    isStreaming = false;
    lastAssistantMessageEl = null;
    lastAssistantContentEl = null;
    streamingRawText = '';
    streamingActivityEl = null;
    streamingAnswerEl = null;
    currentActivityStep = null;
    streamingIndicator.classList.add('hidden');
    sendButton.disabled = false;
    sendButton.textContent = '➤';
    messageInput.disabled = false;
  }

  /** Показать индикатор «в работе» для сессии с активным процессом */
  function showRunningIndicator() {
    isStreaming = true;
    streamingIndicator.classList.remove('hidden');
    sendButton.disabled = false;
    sendButton.textContent = '⏹️';
  }

  /** Скрыть индикатор «в работе» */
  function hideRunningIndicator() {
    isStreaming = false;
    streamingIndicator.classList.add('hidden');
    sendButton.textContent = '➤';
  }

  /**
   * Завершить стриминг — рендерить ТОЛЬКО финальный ответ (без хода выполнения).
   */
  function finishStreaming() {
    if (lastAssistantContentEl) {
      lastAssistantContentEl.innerHTML = renderMarkdown(streamingRawText);
      addCopyButtonsToCodeBlocks(lastAssistantMessageEl || lastAssistantContentEl);
      addCodeToggles(lastAssistantMessageEl || lastAssistantContentEl);
    }

    if (lastAssistantMessageEl) {
      lastAssistantMessageEl.classList.remove('streaming');
    }

    resetStreamingState();
    messageInput.focus();
  }

  /** Добавить кнопки копирования ко всем блокам кода */
  function addCopyButtonsToCodeBlocks(container) {
    if (!container) return;
    const blocks = container.querySelectorAll('pre code');
    blocks.forEach(code => {
      const pre = code.parentElement;
      if (pre.querySelector('.copy-btn')) return; // уже есть
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '📋';
      btn.title = 'Копировать';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent || '').then(() => {
          btn.textContent = '✅';
          setTimeout(() => btn.textContent = '📋', 1500);
        });
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
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

    const mode = document.getElementById('mode-select')?.value || 'agent';
    const provider = document.getElementById('provider-select')?.value || '';
    const model = document.getElementById('model-select')?.value || '';
    // Plan Mode: добавляем флаг в сообщение
    const planMode = document.getElementById('plan-mode-checkbox')?.checked || false;

    postMessage({ type: 'sendMessage', text, mode, provider, model, planMode, sessionId: sessionSelect?.value || '' });

    streamingIndicator.classList.remove('hidden');
    sendButton.textContent = '⏹️';
    sendButton.disabled = false;  // кнопка активна для отмены
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

    // Маршрутизация по сессии: сообщения от другой сессии (streamChunk, done, planGenerated и т.п.)
    // игнорируем — они относятся к чату, который сейчас не активен. Результат уже сохранён в истории
    // и появится при переключении на нужную сессию.
    if (message.sessionId && currentSessionId && message.sessionId !== currentSessionId) {
      return;
    }

    switch (message.type) {
      case 'runStarted':
        runningSessions.add(message.runSessionId);
        if (message.runSessionId === currentSessionId) showRunningIndicator();
        break;
      case 'runEnded':
        runningSessions.delete(message.runSessionId);
        if (message.runSessionId === currentSessionId) hideRunningIndicator();
        break;
      case 'userMessage':
        // Сообщение уже добавлено локально в sendUserMessage(), не дублируем
        break;

      case 'streamChunk':
        // Токен стрима
        appendStreamChunk(message.text);
        break;

      case 'toolActivity':
        // Ход выполнения (tool calls) — структурированные шаги
        handleToolActivity(message.activity);
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

      case 'slashCommands':
        slashItems = message.items || [];
        break;

      case 'sessionTranscript': {
        const text = message.text || '';
        if (message.action === 'download') {
          const blob = new Blob([text], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session_${new Date().toISOString().slice(0, 10)}.md`;
          a.click();
          URL.revokeObjectURL(url);
          const btn = document.getElementById('btn-export');
          if (btn) {
            const orig = btn.textContent;
            btn.textContent = '✅';
            setTimeout(() => btn.textContent = orig, 1500);
          }
        } else {
          navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('btn-share');
            if (btn) {
              const orig = btn.textContent;
              btn.textContent = '✅';
              setTimeout(() => btn.textContent = orig, 1500);
            }
          });
        }
        break;
      }

      case 'confirmAction':
        showConfirmDialog(message);
        break;

      case 'tokens':
        if (message.maxTokens) maxContextTokens = message.maxTokens;
        showTokenUsage(message);
        break;

      case 'retryStatus':
        showRetryStatus(message);
        break;

      case 'planGenerated':
        // Plan Mode: план сгенерирован — показать с кнопками (с исходной сессией)
        showPlan(message.planContent, message.planPath, message.sessionId);
        break;

      case 'implementStarted':
        // Plan Mode: имплементация началась — скрыть план, показать индикатор с кнопкой отмены
        hidePlan();
        isStreaming = true;
        sendButton.textContent = '⏹️';
        sendButton.disabled = false;
        streamingIndicator.classList.remove('hidden');
        break;

      case 'reflectReport':
        // Plan Mode: отчёт ревьюера
        showReflectReport(message.report, message.allPassed);
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
    // Сброс стрим-состояния: при переключении/восстановлении сессии во время активного
    // стрима иначе остаётся «зависший» блок с курсором и заблокированное поле ввода.
    resetStreamingState();

    // Всегда очищаем контейнер
    const welcome = document.getElementById('welcome-message');
    messagesContainer.innerHTML = '';
    if (welcome) {
      messagesContainer.appendChild(welcome);
    }

    // Сбрасываем индикатор токенов при переключении сессии
    const tokenText = document.querySelector('.token-text');
    const tokenFill = document.querySelector('.token-bar-fill');
    const tokenLimit = document.querySelector('.token-limit');
    if (tokenText && tokenFill && tokenLimit) {
      tokenText.textContent = '📊 0+0 ≈ $0.0000';
      tokenFill.style.width = '0%';
      tokenFill.className = 'token-bar-fill';
      tokenLimit.textContent = `0/${maxContextTokens}`;
    }

    if (!messages || messages.length === 0) {
      if (welcome) welcome.classList.remove('hidden');
      return;
    }

    // Скрываем приветствие — есть история сообщений
    if (welcome) welcome.classList.add('hidden');

    // Добавляем каждое сообщение
    for (const msg of messages) {
      addMessage(msg.role, msg.content);
    }
    addCopyButtonsToCodeBlocks(messagesContainer);
    addCodeToggles(messagesContainer);
  }

  // ---------- Session Management ----------

  const sessionSelect = document.getElementById('session-select');
  const btnNewSession = document.getElementById('btn-new-session');
  const btnDeleteSession = document.getElementById('btn-delete-session');

  let updatingSessionList = false;

  function updateSessionList(sessions, activeId) {
    if (!sessionSelect || !sessions) return;
    currentSessionId = activeId || '';
    // Синхронизируем индикатор «в работе» с текущей сессией
    if (runningSessions.has(currentSessionId)) showRunningIndicator();
    else hideRunningIndicator();
    updatingSessionList = true;
    sessionSelect.innerHTML = '';
    for (const s of sessions) {
      const opt = document.createElement('option');
      opt.value = s.id;
      const date = new Date(s.createdAt).toLocaleString('ru-RU', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      opt.textContent = s.name + (s.messageCount > 0 ? ` (${s.messageCount})` : '');
      opt.title = `Создана: ${date} | Двойной клик — переименовать`;
      if (s.id === activeId) opt.selected = true;
      sessionSelect.appendChild(opt);
    }
    updatingSessionList = false;
  }

  if (sessionSelect) {
    sessionSelect.addEventListener('change', () => {
      if (updatingSessionList) return;
      postMessage({ type: 'switchSession', sessionId: sessionSelect.value });
    });
    // Двойной клик — переименовать
    sessionSelect.addEventListener('dblclick', () => {
      const id = sessionSelect.value;
      const currentName = sessionSelect.options[sessionSelect.selectedIndex]?.textContent?.replace(/\s*\(\d+\)\s*$/, '') || '';
      const newName = prompt('Новое имя сессии:', currentName);
      if (newName && newName.trim()) {
        postMessage({ type: 'renameSession', sessionId: id, name: newName.trim() });
      }
    });
  }

  if (btnNewSession) {
    btnNewSession.addEventListener('click', () => {
      postMessage({ type: 'newSession' });
    });
  }

  if (btnDeleteSession) {
    btnDeleteSession.addEventListener('click', () => {
      postMessage({ type: 'deleteSession', sessionId: sessionSelect.value });
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
      const name = typeof m === 'string' ? m : (m.name || String(m));
      opt.value = name;
      opt.textContent = name;
      modelSelect.appendChild(opt);
    }
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', updateModelList);
  }

  // ---------- Confirmation Dialog ----------

  /** LCS-диф строк: возвращает список операций {type: context|remove|add, line} */
  function computeLineDiff(oldLines, newLines) {
    // Вынесено в lineDiff.js (глобальный window.computeLineDiff) — здесь оставлен alias для совместимости.
    return (typeof window !== 'undefined' && window.computeLineDiff)
      ? window.computeLineDiff(oldLines, newLines)
      : [];
  }

  function showConfirmDialog(msg) {
    const existing = document.getElementById('confirm-dialog');
    if (existing) existing.remove();

    let diffHtml = '';
    let diffStats = '';
    if (msg.toolName === 'replace_in_file') {
      const oldLines = (msg.oldStr || '').split('\n');
      const newLines = (msg.newStr || '').split('\n');
      diffHtml = '<div class="git-diff">';
      for (const l of oldLines) {
        diffHtml += `<div class="diff-line diff-removed"><span class="diff-sign">−</span>${escapeHtml(l)}</div>`;
      }
      for (const l of newLines) {
        diffHtml += `<div class="diff-line diff-added"><span class="diff-sign">+</span>${escapeHtml(l)}</div>`;
      }
      diffHtml += '</div>';
    } else if (msg.toolName === 'write_file' && typeof msg.oldContent === 'string') {
      // git-style diff: сравнение старого и нового содержимого файла
      const oldLines = (msg.oldContent || '').split('\n');
      const newLines = (msg.content || '').split('\n');
      const ops = computeLineDiff(oldLines, newLines);
      let added = 0, removed = 0;
      diffHtml = '<div class="git-diff">';
      for (const op of ops) {
        if (op.type === 'context') {
          diffHtml += `<div class="diff-line diff-context">${escapeHtml(op.line)}</div>`;
        } else if (op.type === 'remove') {
          removed++;
          diffHtml += `<div class="diff-line diff-removed"><span class="diff-sign">−</span>${escapeHtml(op.line)}</div>`;
        } else {
          added++;
          diffHtml += `<div class="diff-line diff-added"><span class="diff-sign">+</span>${escapeHtml(op.line)}</div>`;
        }
      }
      diffHtml += '</div>';
      diffStats = `<span class="diff-stat-add">+${added}</span> <span class="diff-stat-del">−${removed}</span>`;
    } else {
      const contentLines = (msg.content || '').split('\n');
      diffHtml = '<div class="git-diff">';
      contentLines.forEach((l, i) => {
        diffHtml += `<div class="diff-line"><span class="diff-ln">${String(i + 1).padStart(4)}</span>${escapeHtml(l)}</div>`;
      });
      diffHtml += '</div>';
    }

    const overlay = document.createElement('div');
    overlay.id = 'confirm-dialog';
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">🔧 ${msg.toolName} — <code>${escapeHtml(msg.filePath || '')}</code></div>
        ${diffStats ? `<div class="diff-stats">${diffStats}</div>` : ''}
        <div class="confirm-body">${diffHtml}</div>
        <div class="confirm-buttons">
          <button class="confirm-reject">❌ Отклонить</button>
          <button class="confirm-approve">✅ Подтвердить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.confirm-approve')?.addEventListener('click', () => {
      postMessage({ type: 'confirmResponse', requestId: msg.requestId, approved: true });
      overlay.remove();
    });
    overlay.querySelector('.confirm-reject')?.addEventListener('click', () => {
      postMessage({ type: 'confirmResponse', requestId: msg.requestId, approved: false });
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); postMessage({ type: 'confirmResponse', requestId: msg.requestId, approved: false }); }
    });
  }

  // ---------- Event Listeners ----------

  window.addEventListener('message', handleMessage);

  // Прикрепление файлов (общая функция)
  async function processAttachedFile(file) {
    const isImage = file.type.startsWith('image/');
    if (isImage) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        const img = document.createElement('img');
        img.src = reader.result;
        img.className = 'chat-image-preview';
        img.alt = file.name;
        const container = document.createElement('div');
        container.className = 'message assistant-message';
        container.innerHTML = `<div class="message-role">📷 ${file.name}</div>`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.appendChild(img);
        container.appendChild(contentDiv);
        if (welcomeMessage && !welcomeMessage.classList.contains('hidden')) {
          welcomeMessage.classList.add('hidden');
        }
        messagesContainer.appendChild(container);
        scrollToBottom();
        postMessage({ type: 'attachFile', fileName: file.name, isImage: true, base64, mimeType: file.type });
      };
      reader.readAsDataURL(file);
    } else {
      const text = await file.text();
      const preview = text.slice(0, 3000);
      const truncated = text.length > 3000 ? `\n... (файл ${text.length} символов)` : '';
      const fileMsg = `**📎 ${file.name}**\n\`\`\`\n${preview}${truncated}\n\`\`\``;
      addMessage('assistant', fileMsg);
      postMessage({ type: 'attachFile', fileName: file.name, content: text });
    }
  }

  // Кнопка прикрепления
  const fileInput = document.getElementById('file-input');
  const btnAttach = document.getElementById('btn-attach');
  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      for (const file of fileInput.files) {
        await processAttachedFile(file);
      }
      fileInput.value = '';
    });
  }

  // ---------- Slash Command Autocomplete ----------

  /** Список доступных слэш-команд (встроенные + скилы), приходит из extension */
  let slashItems = [];

  /** Отфильтрованный список для текущего ввода */
  let slashFiltered = [];

  /** Индекс активного элемента */
  let slashActiveIndex = 0;

  const slashPopup = document.getElementById('slash-autocomplete');

  /** Обработать ввод: показать/скрыть попап автокомплита при наборе /команды */
  function handleSlashAutocomplete() {
    const text = messageInput.value;
    // Триггеры: / — слэш-команды и скилы, @ — оркестратор
    const match = text.match(/^([/@])([^\s]*)$/);
    if (!match) {
      hideSlashPopup();
      return;
    }
    const prefix = match[1];
    const query = match[2].toLowerCase();
    slashFiltered = slashItems.filter((item) => item.prefix === prefix && item.name.toLowerCase().startsWith(query));
    if (slashFiltered.length > 0) {
      slashActiveIndex = 0;
      renderSlashPopup();
    } else {
      hideSlashPopup();
    }
  }

  /** Отрисовать попап автокомплита */
  function renderSlashPopup() {
    if (!slashPopup) return;
    slashPopup.innerHTML = '';
    slashFiltered.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'slash-item' + (i === slashActiveIndex ? ' active' : '');
      const name = document.createElement('span');
      name.className = 'slash-name';
      name.textContent = item.prefix + item.name;
      const desc = document.createElement('span');
      desc.className = 'slash-desc';
      desc.textContent = item.description || '';
      el.appendChild(name);
      el.appendChild(desc);
      if (item.kind === 'skill') {
        const kind = document.createElement('span');
        kind.className = 'slash-kind';
        kind.textContent = 'скил';
        el.appendChild(kind);
      }
      el.addEventListener('mousedown', (e) => { e.preventDefault(); selectSlashItem(item); });
      el.addEventListener('mousemove', () => { if (slashActiveIndex !== i) { slashActiveIndex = i; renderSlashPopup(); } });
      slashPopup.appendChild(el);
    });
    // Позиционируем попап над textarea (учитываем динамическую высоту поля ввода)
    const inputContainer = document.getElementById('input-container');
    if (inputContainer) {
      const textRect = messageInput.getBoundingClientRect();
      const containerRect = inputContainer.getBoundingClientRect();
      slashPopup.style.bottom = (containerRect.bottom - textRect.top + 4) + 'px';
    }
    slashPopup.classList.remove('hidden');
  }

  /** Выбрать команду — подставить в поле ввода */
  function selectSlashItem(item) {
    messageInput.value = item.prefix + item.name + ' ';
    hideSlashPopup();
    messageInput.focus();
  }

  /** Скрыть попап автокомплита */
  function hideSlashPopup() {
    if (slashPopup) slashPopup.classList.add('hidden');
    slashFiltered = [];
    slashActiveIndex = 0;
  }

  messageInput.addEventListener('input', handleSlashAutocomplete);

  // Отправка сообщения по Enter (Shift+Enter — новая строка).
  // При открытом автокомплите: Enter/Tab выбирает, ↑/↓ — навигация, Esc — закрыть.
  messageInput.addEventListener('keydown', (e) => {
    if (slashPopup && !slashPopup.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashActiveIndex = (slashActiveIndex + 1) % slashFiltered.length;
        renderSlashPopup();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashActiveIndex = (slashActiveIndex - 1 + slashFiltered.length) % slashFiltered.length;
        renderSlashPopup();
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        if (slashFiltered[slashActiveIndex]) selectSlashItem(slashFiltered[slashActiveIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSlashPopup();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });

  // Отправка / отмена по кнопке: ➤ отправляет, ⏹️ отменяет
  sendButton.addEventListener('click', () => {
    if (isStreaming) {
      postMessage({ type: 'cancelRequest', sessionId: sessionSelect?.value || '' });
    } else {
      sendUserMessage();
    }
  });

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
    postMessage({ type: 'cancelRequest', sessionId: sessionSelect?.value || '' });
  });

  // Копировать сессию в буфер (транскрипция из session-log через extension)
  const shareButton = document.getElementById('btn-share');
  if (shareButton) {
    shareButton.addEventListener('click', () => {
      postMessage({ type: 'getTranscript', sessionId: sessionSelect?.value || '', action: 'copy' });
    });
  }

  // Экспорт в .md (транскрипция из session-log через extension)
  const exportButton = document.getElementById('btn-export');
  if (exportButton) {
    exportButton.addEventListener('click', () => {
      postMessage({ type: 'getTranscript', sessionId: sessionSelect?.value || '', action: 'download' });
    });
  }

  // Авто-изменение высоты textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  });

  // Быстрые действия
  const quickActions = document.getElementById('quick-actions');
  if (quickActions) {
    quickActions.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const prompts = {
          fix: 'Исправь этот код',
          explain: 'Объясни что делает этот код',
          optimize: 'Оптимизируй этот код'
        };
        messageInput.value = prompts[action] || '';
        sendUserMessage();
        quickActions.style.display = 'none';
      });
    });
  }

  // Сворачивание блоков кода
  messagesContainer.addEventListener('click', (e) => {
    const toggle = e.target.closest('.code-toggle');
    if (toggle) {
      const pre = toggle.closest('pre');
      pre.classList.toggle('code-collapsed');
      toggle.textContent = pre.classList.contains('code-collapsed') ? '▶' : '▼';
    }
  });

  // Добавить кнопки сворачивания ко всем блокам кода
  function addCodeToggles(container) {
    if (!container) return;
    container.querySelectorAll('pre code').forEach(code => {
      const pre = code.parentElement;
      if (pre.querySelector('.code-toggle')) return;
      const btn = document.createElement('button');
      btn.className = 'code-toggle';
      btn.textContent = '▼';
      pre.appendChild(btn);
    });
  }

  // ---------- Plan Mode ----------

  /** Текущий режим (agent/chat) */
  let currentMode = 'agent';

  /**
   * Показать/скрыть переключатель Plan Mode в зависимости от режима.
   */
  function updatePlanModeToggle() {
    const toggle = document.getElementById('plan-mode-toggle');
    if (!toggle) return;
    if (currentMode === 'agent') {
      toggle.classList.remove('hidden');
    } else {
      toggle.classList.add('hidden');
      // Сбрасываем Plan Mode при переключении в chat
      const checkbox = document.getElementById('plan-mode-checkbox');
      if (checkbox) checkbox.checked = false;
    }
  }

  /**
   * Показать сгенерированный план.
   * @param {string} content — markdown плана
   * @param {string} planPath — путь к файлу плана
   */
  function showPlan(content, planPath, sessionId) {
    const container = document.getElementById('plan-container');
    const planContent = document.getElementById('plan-content');
    if (!container || !planContent) return;

    // Рендерим markdown плана (без auto-linking)
    planContent.innerHTML = marked.parse(content, { breaks: true, gfm: false });
    addCodeToggles(planContent);

    // Сохраняем путь и ИСХОДНУЮ сессию для кнопок (результат имплементации должен уйти в ту же сессию)
    container.dataset.planPath = planPath;
    container.dataset.sessionId = sessionId || '';
    container.classList.remove('hidden');
    scrollToBottom();
  }

  /**
   * Скрыть план.
   */
  function hidePlan() {
    const container = document.getElementById('plan-container');
    if (container) {
      container.classList.add('hidden');
    }
  }

  /**
   * Показать отчёт ревьюера.
   * @param {string} report — текст отчёта
   * @param {boolean} allPassed — все AC пройдены
   */
  function showReflectReport(report, allPassed) {
    const prefix = allPassed ? '🎉 **Рефлексия пройдена:**' : '⚠️ **Рефлексия — есть замечания:**';
    addMessage('assistant', `${prefix}\n\n${report}`);
  }

  // Обработчик кнопки «Имплементировать»
  const btnImplement = document.getElementById('btn-implement-plan');
  if (btnImplement) {
    btnImplement.addEventListener('click', () => {
      const container = document.getElementById('plan-container');
      const planPath = container?.dataset.planPath;
      if (planPath) {
        postMessage({ type: 'implementPlan', planPath, sessionId: container?.dataset.sessionId || sessionSelect?.value || '' });
      }
    });
  }

  // Обработчик кнопки «Исправить»
  const btnEdit = document.getElementById('btn-edit-plan');
  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      hidePlan();
      addMessage('assistant', '_План отклонён. Уточни задачу и отправь снова._');
    });
  }

  // Обработчик смены режима (agent ↔ chat) — показать/скрыть Plan Mode
  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) {
    currentMode = modeSelect.value; // синхронизируем начальное состояние
    updatePlanModeToggle();         // показываем/скрываем при загрузке
    modeSelect.addEventListener('change', () => {
      currentMode = modeSelect.value;
      updatePlanModeToggle();
    });
  }

  // ---------- Initialize ----------

  // Отправляем сообщение о готовности WebView
  // Используем setTimeout, чтобы VS Code успел установить обработчик
  setTimeout(() => {
    postMessage({ type: 'ready' });
  }, 100);

  // Получаем API vscode для postMessage
  const vscode = acquireVsCodeApi();

})();