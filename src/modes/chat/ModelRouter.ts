// ModelRouter — оценка стоимости запроса, лимит бюджета сессии и авто-выбор модели.
//
// Всё это про деньги пользователя: прогноз до запроса, стоп на лимите, и подсказка
// «эта задача потянет дешёвую модель». Маршрутизация выключена по умолчанию: угадывать
// имена моделей нельзя, дешёвую и дорогую задаёт пользователь в настройках.

import * as vscode from 'vscode';
import { calculateCost } from '../../providers/types';

/** Слова, которые обычно означают работу «на подумать», а не короткий вопрос. */
const COMPLEX_MARKERS = [
  'рефактор', 'спроект', 'архитектур', 'оптимиз', 'почему', 'объясни', 'разбер',
  'тест', 'баг', 'ревью', 'миграц',
];

/** Контекст, после которого задача считается сложной (токены). */
export const COMPLEX_CONTEXT_TOKENS = 6_000;

/** Длина текста запроса, после которой задача считается сложной (знаки). */
export const COMPLEX_TEXT_CHARS = 1_500;

/** Доля ожидаемого ответа от maxTokens: ответ редко упирается в потолок. */
const OUTPUT_RATIO = 0.3;

export interface RouteInput {
  /** Текст запроса пользователя */
  text: string;
  /** Режим: чат или агент (ReAct + инструменты) */
  mode: 'chat' | 'agent';
  /** План-режим */
  planMode?: boolean;
  /** Оценка контекста в токенах (system + история) */
  contextTokens: number;
}

export interface RouteDecision {
  /** Выбранная модель */
  model: string;
  /** Сложная ли задача по эвристике */
  complex: boolean;
  /** Почему так решили — для debug-канала */
  reason: string;
  /** Модель выбрана автоматически (а не пользователем/настройкой по умолчанию) */
  auto: boolean;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface BudgetState {
  /** Лимит на сессию в USD; 0 — выключен */
  limitUsd: number;
  /** Уже потрачено в сессии */
  spentUsd: number;
}

export type BudgetVerdict =
  | { kind: 'off' }
  | { kind: 'ok' }
  | { kind: 'warn'; percent: number }
  | { kind: 'exceed'; totalUsd: number; overUsd: number };

/** Сложная ли задача — по явным правилам, а не по «ощущению». */
export function isComplexTask(input: RouteInput): { complex: boolean; reason: string } {
  if (input.mode === 'agent') return { complex: true, reason: 'агентский режим' };
  if (input.planMode) return { complex: true, reason: 'режим плана' };
  if (input.contextTokens > COMPLEX_CONTEXT_TOKENS) {
    return { complex: true, reason: `контекст ${Math.round(input.contextTokens)} токенов` };
  }
  if (input.text.length > COMPLEX_TEXT_CHARS) {
    return { complex: true, reason: `длинный запрос ${input.text.length} знаков` };
  }
  const lower = input.text.toLowerCase();
  const marker = COMPLEX_MARKERS.find((word) => lower.includes(word));
  if (marker) return { complex: true, reason: `слово «${marker}»` };
  return { complex: false, reason: 'короткий простой запрос' };
}

/**
 * Выбрать модель под задачу.
 *
 * Маршрутизация работает только если `routing.auto` включена и обе модели заданы.
 * Явный выбор пользователя в панели не переопределяется (кроме `routing.overrideChosen`).
 */
export function chooseModel(input: RouteInput, fallbackModel: string): RouteDecision {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  const auto = config.get<boolean>('routing.auto', false);
  const simpleModel = (config.get<string>('routing.simpleModel', '') || '').trim();
  const complexModel = (config.get<string>('routing.complexModel', '') || '').trim();
  const { complex, reason } = isComplexTask(input);

  if (!auto || !simpleModel || !complexModel) {
    return { model: fallbackModel, complex, reason, auto: false };
  }

  const model = complex ? complexModel : simpleModel;
  return { model, complex, reason, auto: model !== fallbackModel };
}

/** Оценка стоимости запроса: вход по факту контекста, выход — доля maxTokens. */
export function estimateRequestCost(
  contextTokens: number,
  maxTokens: number,
  model: string,
  pricingMap?: Map<string, { input: number; output: number }>,
): CostEstimate {
  const inputTokens = Math.max(0, Math.round(contextTokens));
  const outputTokens = Math.max(1, Math.round(maxTokens * OUTPUT_RATIO));
  return {
    inputTokens,
    outputTokens,
    cost: calculateCost(model, inputTokens, outputTokens, pricingMap),
  };
}

/**
 * Проверка лимита сессии. `warnPercent` — порог предупреждения (по умолчанию 80%).
 */
export function checkBudget(state: BudgetState, estimateUsd: number, warnPercent = 80): BudgetVerdict {
  if (!state.limitUsd || state.limitUsd <= 0) return { kind: 'off' };
  const after = state.spentUsd + estimateUsd;
  if (after > state.limitUsd) {
    return {
      kind: 'exceed',
      totalUsd: after,
      overUsd: after - state.limitUsd,
    };
  }
  const percent = Math.round((after / state.limitUsd) * 100);
  if (percent >= warnPercent) return { kind: 'warn', percent };
  return { kind: 'ok' };
}
