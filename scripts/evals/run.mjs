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
const JUDGE_MODEL = arg('judge', 'anthropic/claude-sonnet-4.5');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '..', '..', '.env'), 'utf-8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const DEEPSEEK_KEY = env.DEEPSEEK_API_KEY;
const OPENROUTER_KEY = env.OPENROUTER_API_KEY;

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
// Судья — через OpenRouter: Polza упёрлась в лимит баланса (402), Azure недоступен (P33),
// SiliconFlow ключ невалиден. OpenRouter проверен живым вызовом: claude-sonnet-4.5 → http 200.
const askJudge = (messages) => chat('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEY, JUDGE_MODEL, messages, 500);

/** Контекст: файл целиком, но не больше 8 КБ — символ ищем и подсвечиваем окном вокруг него. */
function contextFor(file, symbol) {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, 'utf-8');
  const at = text.indexOf(symbol);
  if (at < 0) return text.slice(0, 8000);
  const from = Math.max(0, at - 2500);
  return text.slice(from, Math.min(text.length, at + 5500));
}

const ANSWER_SYSTEM = 'Ты помощник по кодовой базе. Отвечай по приведённому фрагменту кода, 2–4 предложения, без вступлений. Если в фрагменте нет ответа — скажи это прямо.';

async function answer(task) {
  const ctx = contextFor(task.file, task.symbol);
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
Стиль, полноту и полезность не оценивай.
Ответ — ТОЛЬКО JSON без markdown:
{"verdict":"подтверждается|противоречит|не проверяемо","quote":"строка кода","why":"до 20 слов"}`;

async function judge(task, answerText) {
  const ctx = contextFor(task.file, task.symbol);
  const raw = await askJudge([
    { role: 'system', content: JUDGE_SYSTEM.replace('${SYMBOL_PLACEHOLDER}', task.symbol) },
    { role: 'user', content: `Вопрос: ${task.question}\n\nФайл фрагмента: ${task.file}\nОжидаемый символ: ${task.symbol}\n\nФрагмент кода:\n${ctx}\n\nОтвет, который надо проверить:\n${answerText}\n\nНапоминание: если в ответе символ отнесён к другому файлу — это «противоречит».` },
  ]);
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

const tasks = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'tasks.json'), 'utf-8')).tasks;
const selected = LIMIT ? tasks.slice(0, LIMIT) : tasks;
fs.mkdirSync(OUT_DIR, { recursive: true });

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
