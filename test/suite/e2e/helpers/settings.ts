// Сохранение и восстановление ключей конфигурации между тестом и teardown.

import * as vscode from 'vscode';

const cfg = () => vscode.workspace.getConfiguration('llmAssistant');

export interface SettingsSnapshot {
  restore: () => Promise<void>;
}

/** Запомнить текущие значения ключей и записать новые (Global scope тестового окна). */
export async function applySettings(values: Record<string, unknown>): Promise<SettingsSnapshot> {
  const saved = new Map<string, unknown>();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, cfg().get(key));
    await cfg().update(key, value, vscode.ConfigurationTarget.Global);
  }
  return {
    restore: async () => {
      for (const [key, value] of saved) {
        await cfg().update(key, value, vscode.ConfigurationTarget.Global);
      }
    },
  };
}

/** Прочитать значение настройки плагина. */
export function getSetting<T>(key: string): T | undefined {
  return cfg().get<T>(key);
}
