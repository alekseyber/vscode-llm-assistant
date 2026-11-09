// Утилита логирования с учётом настройки llmAssistant.debug
// Уровень DEBUG пишется в консоль только при llmAssistant.debug: true
// Уровни: INFO, WARN, ERROR всегда, DEBUG — только по настройке

import * as vscode from 'vscode';

/**
 * Проверить, включён ли DEBUG-режим в настройках.
 * Читает настройку llmAssistant.debug напрямую при каждом вызове,
 * поэтому изменение применяется сразу, без перезапуска.
 */
export function isDebugEnabled(): boolean {
  return vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
}

/** Куда дублировать DEBUG-строки, кроме консоли (канал «LLM Assistant»). */
let debugSink: { appendLine(value: string): void } | undefined;

/**
 * Подключить канал вывода к DEBUG-логу.
 *
 * Зачем: строки провайдеров (`[ollama] prompt_eval_count=…`) раньше уходили только
 * в console.log, то есть их не было в канале «LLM Assistant», где панель пишет свои
 * `[DEBUG] …`. Из-за этого проверка «счётчик виден в debug-канале» была невыполнима,
 * а диагностика обрезки промпта существовала только для того, кто откроет DevTools.
 */
export function setDebugSink(sink: { appendLine(value: string): void } | undefined): void {
  debugSink = sink;
}

/**
 * Записать DEBUG-сообщение в консоль и в подключённый канал.
 * Сообщение пишется только при llmAssistant.debug: true.
 * @param message — текст сообщения
 */
export function debugLog(message: string): void {
  if (!isDebugEnabled()) return;
  const line = `[DEBUG] ${message}`;
  console.log(line);
  // Канал может быть уже закрыт (dispose расширения) — лог не должен падать из-за этого.
  try {
    debugSink?.appendLine(line);
  } catch {
    /* канал недоступен — строку уже получила консоль */
  }
}