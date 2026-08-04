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

/**
 * Записать DEBUG-сообщение в консоль.
 * Сообщение пишется только при llmAssistant.debug: true.
 * @param message — текст сообщения
 */
export function debugLog(message: string): void {
  if (isDebugEnabled()) {
    console.log(`[DEBUG] ${message}`);
  }
}