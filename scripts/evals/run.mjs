// Offline-evals качества ответов (P12, шаг 1).
//
// Что меряем: способна ли модель ответить по факту из кода, когда нужный файл уже в контексте.
// Это не проверка поиска (её меряет scripts/acceptance) и не проверка агентского цикла —
// только связка «контекст → ответ», где и живут выдумки.
//
// Три слоя:
//   1. Механическая проверка: ответ обязан упомянуть ожидаемый символ (без модели, детерминированно).
//   2. Судья — независимая модель другого вендора (по умолчанию anthropic/claude-opus-5.5 через Polza):
//      «подтверждается / противоречит / не проверяемо» с цитатой из кода.
//   3. Калибровка судьи: пять заведомо испорченных ответов. Судья, пропустивший хоть один,
//      помечается непригодным, и отчёт говорит это прямо, а не выдаёт «всё ок».
//
// Запуск: node scripts/evals/run.mjs [--limit=N] [--answer-model=deepseek-chat] [--judge=anthropic/claude-opus-5.5]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.join(import.meta.dirname, '..', '..'));
const EVAL_DIR = path.join(ROOT, 'scripts', 'evals');
const OUT_DIR = path.join(ROOT, 'reports', 'evals');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const LIMIT = Number(arg('limit', '0')) || 0;
const ANSWER_MODEL = arg('answer-model', 'deepseek-chat');
const JUDGE_MODEL = arg('judge', 'deepseek-chat');
const JUDGE_PROVIDER = arg('judge-provider', 'deepseek');

// Ключи: сначала окружение (в CI это secrets), и только если там пусто — локальный .env.
// В репозиторий ключи не попадают никогда: файл лежит вне проекта, а отчёты — в reports/ (не трекается).
function loadEnv() {
  const fromProcess = {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_EVALS_KEY: process.env.DEEPSEEK_EVALS_KEY,
    POLZA_AI_API_KEY: process.env.POLZA_AI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  const defined = Object.fromEntries(Object.entries(fromProcess).filter(([, v]) => Boolean(v)));
  const envPath = process.env.EVALS_ENV_FILE || path.join(ROOT, '..', '..', '.env');
  // Файл читаем ВСЕГДА, если он есть: в окружении могут быть только часть ключей
  // (например, POLZA задана, DEEPSEEK — нет), и ранний возврат оставлял ключ пустым.
  if (!fs.existsSync(envPath)) return defined;
  const fileEnv = Object.fromEntries(
    fs.readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  return { ...fileEnv, ...defined };
}

const env = loadEnv();
if (!DEEPSEEK_KEY && !env.POLZA_AI_API_KEY && !env.OPENROUTER_API_KEY) {
  console.error('[evals] нет ключей провайдеров (env или .env) — прогон невозможен');
  process.exit(4);
}

// Отдельный ключ под evals (CI) приоритетнее общего: его можно отозвать, не ломая остальное
const DEEPSEEK_KEY = env.DEEPSEEK_EVALS_KEY || env.DEEPSEEK_API_KEY;
const OPENROUTER_KEY = env.OPENROUTER_API_KEY;
const POLZA_KEY = env.POLZA_AI_API_KEY;

async function chat(url, key, model, messages, maxTokens = 700) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${model}: http ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.choices?.[0]?.message?.content?.trim() ?? '';
}

const askDeepSeek = (messages) => chat('https://api.deepseek.com/chat/completions', DEEPSEEK_KEY, ANSWER_MODEL, messages);
// Судья по умолчанию — deepseek-chat: не reasoning (лимит не съедается скрытыми токенами),
// предсказуемая цена, свой ключ с балансом. Кросс-вендорные модели (Claude через Polza) —
// только явным флагом и с бюджетом: Polza списала ~500 ₽ за ~15 вызовов Haiku, оценка по
// прайсу Anthropic это не объясняет, поэтому дорогой провайдер не используется без разрешения.
// Кросс-вендорная проверка запускается отдельно и намеренно дорого: --judge=anthropic/claude-sonnet-4.5
// --judge-provider=polza. Один такой прогон ≈85 ₽, поэтому он контрольный, а не рабочий.
const JUDGE_ENDPOINTS = {
  deepseek: ['https://api.deepseek.com/chat/completions', DEEPSEEK_KEY],
  polza: ['https://polza.ai/api/v1/chat/completions', POLZA_KEY],
  openrouter: ['https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEY],
};
const [judgeUrl, judgeKey] = JUDGE_ENDPOINTS[JUDGE_PROVIDER] ?? JUDGE_ENDPOINTS.deepseek;
// 500 токенов не хватает: у deepseek-v4-pro reasoning-токены списываются из completion_tokens,
// и при малом лимите ответ приходит пустым (finish_reason=length) — отсюда было «нет вердикта».
const askJudge = (messages) => chat(judgeUrl, judgeKey, JUDGE_MODEL, messages, 2000);

/** Контекст задачи. Три режима:
 *  - обычный: окно вокруг символа;
 *  - `contextFiles`: несколько файлов (кросс-файловые вопросы — факт в одном, вызов в другом);
 *  - `truncate`: символ и его окрестность ВЫРЕЗАНЫ — правильный ответ «по фрагменту ответить нельзя».
 */
function contextFor(task) {
  const readWindow = (file, symbol, cut) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const at = symbol ? text.indexOf(symbol) : -1;
    if (at < 0) return `// ${file}\n${text.slice(0, 4000)}`;
    if (cut) {
      // Вырезаем ЦЕЛИКОМ функцию/класс, в котором объявлен символ: если оставить тело и убрать
      // только имя, модель всё равно отвечает по телу — задача «на честный отказ» не работает.
      const start = Math.max(
        text.lastIndexOf('export function', at),
        text.lastIndexOf('function', at),
        text.lastIndexOf('export class', at),
        text.lastIndexOf('class', at),
        text.lastIndexOf('const', at),
      );
      const from = start >= 0 ? start : Math.max(0, at - 200);
      let depth = 0;
      let end = from;
      let seenBrace = false;
      for (let i = from; i < text.length; i += 1) {
        if (text[i] === '{') { depth += 1; seenBrace = true; }
        else if (text[i] === '}') { depth -= 1; if (seenBrace && depth === 0) { end = i + 1; break; } }
      }
      // Плюс затираем все вхождения имени: оно может встречаться в соседних функциях и в тестах
      const cutText = (text.slice(0, from) + '\n/* фрагмент вырезан */\n' + text.slice(end))
        .split(symbol).join('/* имя вырезано */')
        .slice(0, 8000);
      if (cutText.includes(symbol)) throw new Error(`truncate: символ ${symbol} остался в контексте`);
      return `// ${file}\n${cutText}`;
    }
    return `// ${file}\n${text.slice(Math.max(0, at - 2000), Math.min(text.length, at + 4000))}`;
  };
  if (task.contextFiles) return task.contextFiles.map((f) => readWindow(f, task.symbol, false)).join('\n\n');
  return readWindow(task.file, task.symbol, Boolean(task.truncate));
}

const ANSWER_SYSTEM = 'Ты помощник по кодовой базе. Отвечай по приведённому фрагменту кода, 2–4 предложения, без вступлений. Если в фрагменте нет ответа — скажи это прямо.';

async function answer(task) {
  const ctx = contextFor(task);
  return askDeepSeek([
    { role: 'system', content: ANSWER_SYSTEM },
    { role: 'user', content: `Файл ${task.file}:\n\n${ctx}\n\nВопрос: ${task.question}` },
  ]);
}

const JUDGE_SYSTEM = `Ты проверяешь фактическую верность ответа по фрагменту кода.
Правила:
- Оценивай только факты: соответствует ли сказанное строкам кода.
- Называть символ НЕ обязательно: если ответ отвечает по существу и не врёт — это «подтверждается».
- Но если ответ помещает символ в ДРУГОЙ файл, чем фрагмент, — это «противоречит» (проверь имя файла во фрагменте выше).
- Если ответ описывает поведение, которого в коде нет (выдуманная функция, другой результат), — «противоречит».
- Если ответ утверждает, что во фрагменте нет нужных строк, и это правда — тоже «подтверждается» (честный отказ не ошибка).
- «противоречит» — только когда утверждение расходится с кодом (другое поведение, другой файл, выдуманная функция, перевёрнутый смысл).
- «не проверяемо» — если по фрагменту нельзя установить ни верность, ни ложность.
Если в задаче помечено «ожидается честный отказ»: правильный ответ — сказать, что по фрагменту ответить нельзя.
Выдумка в таком случае — «противоречит».
Стиль, полноту и полезность не оценивай.
Ответ — ТОЛЬКО JSON без markdown:
{"verdict":"подтверждается|противоречит|не проверяемо","quote":"строка кода","why":"до 20 слов"}`;

async function judge(task, answerText) {
  const ctx = contextFor(task);
  let raw = '';
  try {
    raw = await askJudge([
    { role: 'system', content: JUDGE_SYSTEM.replace('${SYMBOL_PLACEHOLDER}', task.symbol) },
      { role: 'user', content: `Вопрос: ${task.question}\n${task.truncate ? 'Ожидается честный отказ: нужного кода в фрагменте НЕТ.\n' : ''}\n\nФайл фрагмента: ${task.file}\nОжидаемый символ: ${task.symbol}\n\nФрагмент кода:\n${ctx}\n\nОтвет, который надо проверить:\n${answerText}\n\nНапоминание: если в ответе символ отнесён к другому файлу — это «противоречит».` },
    ]);
  } catch (error) {
    // Судья недоступен (лимит, сеть, 5xx) — это НЕ «ответ неверный»: фиксируем отдельным
    // вердиктом, чтобы отчёт не врал в сторону брака
    const reason = String(error.message ?? error).replace(/\s+/g, ' ').slice(0, 120);
    return { verdict: 'судья недоступен', raw: reason };
  }
  const parse = (text) => {
    const jsonText = /\{[\s\S]*\}/.exec(text)?.[0];
    try {
      const obj = JSON.parse(jsonText ?? '');
      const v = String(obj.verdict ?? '').toLowerCase();
      if (['подтверждается', 'противоречит', 'не проверяемо'].includes(v)) return { verdict: v, quote: obj.quote, why: obj.why, raw: text };
    } catch { /* ниже — второй шанс */ }
    const plain = /вердикт:\s*(подтверждается|противоречит|не проверяемо)/i.exec(text)?.[1]?.toLowerCase();
    return plain ? { verdict: plain, raw: text } : null;
  };
  const first = parse(raw);
  if (first) return first;
  // Формат сломался — одна попытка переспросить, иначе честно «нет вердикта» (а не «противоречит»)
  const retry = await askJudge([
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: `Верни только JSON. Вопрос: ${task.question}\nОтвет: ${answerText.slice(0, 1500)}\nФрагмент: ${ctx.slice(0, 4000)}` },
  ]);
  return parse(retry) ?? { verdict: 'нет вердикта', raw: raw || retry };
}

/** Пять испорченных ответов: подменённый символ, выдуманное поведение, перевёрнутый смысл. */
function corrupted(task) {
  // Обязательно из ДРУГОГО файла: иначе «чужой символ» не отличить от соседней функции в том же файле
  const other = tasks.find((t) => t.symbol !== task.symbol && t.file !== task.file);
  return [
    { kind: 'чужой символ', text: `${task.symbol} реализован в файле ${other.file} и отвечает за ${other.question}` },
    { kind: 'выдуманная функция', text: `Функция ${task.symbol}NotFound() обрабатывает это, а ${task.symbol} только логирует вызов.` },
    { kind: 'перевёрнутый смысл', text: `Всё наоборот: ${task.symbol} ничего не вычисляет, он только пишет в лог и возвращает пустую строку.` },
  ];
}

// Оценка стоимости ДО прогона: отладка промпта судьи на дорогой модели уже стоила 293 ₽ за вечер.
// Цены за 1M токенов (вход/выход) для тех моделей, которыми реально пользуемся.
const PRICES = {
  'deepseek-chat': [0.14, 0.28],
  'deepseek-v4-pro': [0.28, 0.56],
  'anthropic/claude-opus-5.5': [15, 75],
  'anthropic/claude-haiku-5.5': [1, 5],
  'anthropic/claude-sonnet-4.5': [3, 15],
  'anthropic/claude-sonnet-4.5': [3, 15],
  'anthropic/claude-opus-5.5': [15, 75],
  'anthropic/claude-haiku-5.5': [1, 5],
  'anthropic/claude-sonnet-4.5': [3, 15],
};
const estimateCost = (totalTasks) => {
  const freeTier = JUDGE_MODEL.endsWith(':free');
  const inTokens = totalTasks * 3000 + 6 * 3000;      // контекст задачи + калибровка
  const outTokens = totalTasks * 120 + 6 * 120;
  const answerPrice = PRICES[ANSWER_MODEL] ?? [0.3, 0.6];
  const judgePrice = freeTier ? [0, 0] : PRICES[JUDGE_MODEL] ?? [3, 15];
  const usd = (inTokens * (answerPrice[0] + judgePrice[0]) + outTokens * (answerPrice[1] + judgePrice[1])) / 1_000_000;
  return usd;
};

const tasks = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'tasks.json'), 'utf-8')).tasks;
const planned = LIMIT ? Math.min(LIMIT, tasks.length) : tasks.length;
const usdEstimate = estimateCost(planned);
const budgetUsd = Number(arg('budget', '0.5'));
if (usdEstimate > budgetUsd && !process.argv.includes('--yes')) {
  console.error(`[evals] ОЦЕНКА $${usdEstimate.toFixed(3)} > бюджета $${budgetUsd}. ` +
    `Судья «${JUDGE_MODEL}», ответы «${ANSWER_MODEL}». Отладку вести на дешёвой модели, ` +
    `для запуска добавить --yes или поднять --budget.`);
  process.exit(3);
}
const onlyArg = arg('only', '');
const selected = onlyArg
  ? tasks.filter((t) => onlyArg.split(',').map((x) => x.trim()).includes(t.id))
  : LIMIT ? tasks.slice(0, LIMIT) : tasks;
fs.mkdirSync(OUT_DIR, { recursive: true });
console.error(`[evals] оценка стоимости: $${usdEstimate.toFixed(3)} (${planned} задач, судья ${JUDGE_MODEL})`);

const rows = [];
for (const task of selected) {
  process.stderr.write(`[evals] ${task.id} ${task.symbol}… `);
  const text = await answer(task);
  const mech = task.mechanicalRequired === false ? null : text.toLowerCase().includes(task.symbol.toLowerCase());
  // Детерминированная проверка атрибуции: если ответ называет файлы, ожидаемый должен быть среди них.
  // Судья на этом классе ошибается (пропускает «символ живёт в другом файле»), код — нет.
  const mentioned = [...text.matchAll(/(?:^|[\s`(])((?:src|scripts)\/[\w./-]+\.ts)/g)].map((m) => m[1]);
  const attributionWrong = mentioned.length > 0 && !mentioned.includes(task.file);
  const j = await judge(task, text);
  rows.push({ ...task, answer: text, mechanical: mech, attributionWrong, mentionedFiles: mentioned, judge: j.verdict, judgeRaw: j.raw, quote: j.quote, why: j.why });
  process.stderr.write(`${mech === null ? 'mech-n/a' : mech ? 'mech-ok' : 'mech-miss'} / ${j.verdict}\n`);
}

// Калибровка: испорченные ответы должны быть отвергнуты судьёй
const calibration = [];
for (const task of selected.slice(0, 2)) {
  for (const bad of corrupted(task)) {
    const j = await judge(task, bad.text);
    if (j.verdict === 'судья недоступен') { calibration.push({ task: task.id, kind: bad.kind, verdict: j.verdict, passed: false }); continue; }
    // У каждого класса брака свой слой: «чужой символ» ловит детерминированная проверка атрибуции
    // (судья на нём ошибается — это проверено), поведенческие классы — судья.
    const files = [...bad.text.matchAll(/(?:^|[\s`(])((?:src|scripts)\/[\w./-]+\.ts)/g)].map((m) => m[1]);
    const attributionWrong = files.length > 0 && !files.includes(task.file);
    const passed = j.verdict !== 'подтверждается' || attributionWrong;
    calibration.push({ task: task.id, kind: bad.kind, verdict: j.verdict, attributionWrong, passed });
  }
}
const calibrationOk = calibration.every((c) => c.passed);

const stats = {
  total: rows.length,
  mechanical: rows.filter((r) => r.mechanical === true).length,
  mechanicalApplicable: rows.filter((r) => r.mechanical !== null).length,
  attributionWrong: rows.filter((r) => r.attributionWrong).length,
  confirmed: rows.filter((r) => r.judge === 'подтверждается').length,
  contradicted: rows.filter((r) => r.judge === 'противоречит').length,
  unchecked: rows.filter((r) => r.judge === 'не проверяемо' || r.judge === 'нет вердикта').length,
  judgeUnavailable: rows.filter((r) => r.judge === 'судья недоступен').length,
  judge: JUDGE_MODEL,
  answerModel: ANSWER_MODEL,
  calibrationOk,
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonPath = path.join(OUT_DIR, `run-${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify({ stats, rows, calibration }, null, 2), 'utf-8');

const md = [
  `# Offline-evals — ${stamp}`,
  '',
  `Модель ответов: \`${ANSWER_MODEL}\`, судья: \`${JUDGE_MODEL}\``,
  '',
  `- задач: ${stats.total}`,
  `- механическая проверка (символ в ответе): ${stats.mechanical}/${stats.mechanicalApplicable} применимых`,
  `- атрибуция файла (код, не судья): ошибок ${stats.attributionWrong}`,
  `- судья: подтверждается ${stats.confirmed}, противоречит ${stats.contradicted}, не проверяемо ${stats.unchecked}`,
  `- калибровка судьи: ${calibrationOk ? 'пройдена' : 'НЕ ПРОЙДЕНА — вердиктам судьи доверять нельзя'}`,
  '',
  '| id | символ | мех. | судья | вопрос |',
  '|----|--------|------|-------|--------|',
  ...rows.map((r) => `| ${r.id} | \`${r.symbol}\` | ${r.mechanical === null ? 'н/п' : r.mechanical ? '✅' : '—'} | ${r.judge} | ${r.question} |`),
  '',
  '## Калибровка',
  '',
  ...calibration.map((c) => `- ${c.task} / ${c.kind}: ${c.verdict} ${c.passed ? '' : '← судья пропустил брак'}`),
].join('\n');

const mdPath = path.join(OUT_DIR, `run-${stamp}.md`);
fs.writeFileSync(mdPath, md + '\n', 'utf-8');
console.log(md);
console.error(`[evals] отчёт: ${mdPath}`);
if (!calibrationOk) process.exitCode = 2;
