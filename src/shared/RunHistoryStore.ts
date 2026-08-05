// Хранилище истории запусков агента и чата (слой 07 Product Shell)
// Хранение: глобальное состояние расширения (persistent между сессиями VS Code)
// FIFO: максимум 100 записей, старые вытесняются

import * as vscode from 'vscode';

// --- Типы ---

/** Запись одного запуска (чат, агент, edit) */
export interface RunEntry {
  /** Уникальный идентификатор запуска */
  id: string;
  /** Unix timestamp начала запуска (мс) */
  timestamp: number;
  /** Режим запуска */
  mode: 'chat' | 'agent' | 'edit';
  /** Первые 100 символов запроса пользователя */
  task: string;
  /** Имя провайдера */
  provider: string;
  /** Имя модели */
  model: string;
  /** Количество шагов (для агента — итераций ReAct-цикла) */
  steps: number;
  /** Входные токены (приблизительно) */
  tokensIn: number;
  /** Выходные токены (приблизительно) */
  tokensOut: number;
  /** Стоимость в USD */
  cost: number;
  /** Длительность выполнения (мс) */
  duration: number;
  /** Статус завершения */
  status: 'success' | 'error' | 'cancelled' | 'limit_exceeded';
  /** Сообщение об ошибке (только если status === 'error') */
  error?: string;
}

// --- Константы ---

/** Ключ для хранения в globalState */
const STORAGE_KEY = 'llmAssistant.runHistory';

/** Максимальное количество записей (FIFO) */
const MAX_RUNS = 100;

// --- Хранилище ---

/**
 * RunHistoryStore — хранилище истории запусков.
 * Использует ExtensionContext.globalState для персистентности (переживает перезагрузки VS Code).
 */
export class RunHistoryStore {
  private globalState: vscode.Memento;

  /**
   * @param globalState - глобальное состояние расширения (из ExtensionContext)
   */
  constructor(globalState: vscode.Memento) {
    this.globalState = globalState;
  }

  /**
   * Записать новый запуск в историю.
   * Добавляется в начало массива (самые новые — сверху).
   * Если записей больше MAX_RUNS — старые вытесняются (FIFO).
   *
   * @param entry - запись о запуске
   */
  recordRun(entry: RunEntry): void {
    const runs = this.getRuns();
    runs.unshift(entry);

    // FIFO: оставляем только MAX_RUNS последних
    if (runs.length > MAX_RUNS) {
      runs.length = MAX_RUNS;
    }

    this.globalState.update(STORAGE_KEY, runs);
  }

  /**
   * Получить историю запусков.
   *
   * @param limit - максимальное количество записей (опционально)
   * @returns массив записей (от новых к старым)
   */
  getRuns(limit?: number): RunEntry[] {
    const runs = this.globalState.get<RunEntry[]>(STORAGE_KEY, []);

    if (limit && limit > 0 && runs.length > limit) {
      return runs.slice(0, limit);
    }

    return runs;
  }

  /**
   * Очистить всю историю запусков.
   */
  clearHistory(): void {
    this.globalState.update(STORAGE_KEY, []);
  }
}

/**
 * Сгенерировать уникальный идентификатор для запуска.
 * Формат: run_<timestamp>_<random6>
 */
export function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
