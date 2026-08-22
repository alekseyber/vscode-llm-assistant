// SessionLog — append-only журнал событий сессии (F1)
// Единый источник правды для истории/реплея/экспорта/telemetry.
// Инвариант «model-visible ⟺ logged»: всё видимое модели восстановимо из лога.
// Консолидирует разрозненные источники (SessionManager.messages, RunHistoryStore, ContextSummarizer).

import * as vscode from 'vscode';

/** Идентификатор шага ReAct-цикла (уникален в рамках сессии) */
export type StepId = string;

/** Базовые поля любого события сессии */
interface SessionEventBase {
  /** ID сессии, которой принадлежит событие */
  sessionId: string;
  /** Время события (ms epoch) — для реплея и telemetry */
  ts: number;
}

/**
 * Событие сессии — discriminated union по `type`.
 * Порядок событий в логе = порядок добавления (append-only).
 */
export type SessionEvent =
  | (SessionEventBase & { type: 'user/message'; content: string; pendingContext?: string })
  | (SessionEventBase & { type: 'assistant/chunk'; delta: string })
  | (SessionEventBase & { type: 'assistant/message'; content: string })
  | (SessionEventBase & { type: 'step/start'; stepId: StepId })
  | (SessionEventBase & { type: 'tool/call'; stepId: StepId; name: string; args: Record<string, unknown> })
  | (SessionEventBase & { type: 'tool/result'; stepId: StepId; name: string; result: string; error?: string })
  | (SessionEventBase & { type: 'step/end'; stepId: StepId })
  | (SessionEventBase & { type: 'confirm'; toolName: string; accepted: boolean })
  | (SessionEventBase & { type: 'summary'; content: string; replacedRange: [number, number] })
  | (SessionEventBase & { type: 'error'; message: string });

/** Тип события — для switch по дискриминанту */
export type SessionEventType = SessionEvent['type'];

const LOG_KEY = 'llmAssistant.sessionLog';

/**
 * SessionLog — append-only журнал событий по сессиям.
 * Хранение (Этап 1–3): `vscode.Memento` (workspaceState), ключ `llmAssistant.sessionLog`.
 */
export class SessionLog {
  private storage: vscode.Memento;
  private logs: Map<string, SessionEvent[]> = new Map();

  constructor(storage: vscode.Memento) {
    this.storage = storage;
    this.load();
  }

  /** Добавить событие в конец лога. Append-only — существующие события не мутирует. */
  append(event: SessionEvent): void {
    const list = this.logs.get(event.sessionId) ?? [];
    list.push(event);
    this.logs.set(event.sessionId, list);
    this.save();
  }

  /** Все события сессии (опционально — не раньше `since`). */
  getEvents(sessionId: string, since?: number): SessionEvent[] {
    const list = this.logs.get(sessionId) ?? [];
    return since === undefined ? [...list] : list.filter(e => e.ts >= since);
  }

  /** Полный путь сессии — для UI-реплея и экспорта. */
  replay(sessionId: string): SessionEvent[] {
    return this.getEvents(sessionId);
  }

  /** Создать копию сессии до текущей точки (fork/resume). */
  fork(sourceId: string): string {
    const newId = `session_${crypto.randomUUID()}`;
    const source = this.logs.get(sourceId) ?? [];
    this.logs.set(newId, source.map(e => ({ ...e, sessionId: newId })));
    this.save();
    return newId;
  }

  private load(): void {
    try {
      const saved = this.storage.get<Record<string, SessionEvent[]>>(LOG_KEY, {});
      for (const [id, events] of Object.entries(saved)) {
        this.logs.set(id, events);
      }
    } catch (err) {
      console.error('[SessionLog] Ошибка загрузки, сброс:', err);
      this.logs.clear();
    }
  }

  private save(): void {
    const obj: Record<string, SessionEvent[]> = {};
    for (const [id, events] of this.logs) {
      obj[id] = events;
    }
    this.storage.update(LOG_KEY, obj);
  }
}
