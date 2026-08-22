// SessionLog — append-only журнал событий сессии (F1)
// Единый источник правды для истории/реплея/экспорта/telemetry.
// Инвариант «model-visible ⟺ logged»: всё видимое модели восстановимо из лога.
// Консолидирует разрозненные источники (SessionManager.messages, RunHistoryStore, ContextSummarizer).

import * as vscode from 'vscode';
import { ChatMessage } from '../providers/types';

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

  /**
   * Чистая проекция лога в модельный контекст (SL-3).
   * Не мутирует лог: отбрасывает события до последнего summary-маркера,
   * проецирует user/message + assistant/message, обрезает по токенам (сохраняя summary).
   */
  deriveMessages(sessionId: string, options?: { maxContextTokens?: number }): ChatMessage[] {
    const events = this.getEvents(sessionId);
    const messages: ChatMessage[] = [];

    // Последний summary-маркер — вся история до него представлена им
    let lastSummaryIdx = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'summary') lastSummaryIdx = i;
    }

    // summary-маркер → system-сообщение (сжатая история)
    if (lastSummaryIdx >= 0) {
      const s = events[lastSummaryIdx] as Extract<SessionEvent, { type: 'summary' }>;
      messages.push({ role: 'system', content: `## Краткое содержание предыдущего диалога:\n${s.content}` });
    }

    // Проецируем события ПОСЛЕ маркера
    for (let i = lastSummaryIdx + 1; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'user/message') {
        messages.push({ role: 'user', content: e.pendingContext ? `${e.pendingContext}\n${e.content}` : e.content });
      } else if (e.type === 'assistant/message') {
        messages.push({ role: 'assistant', content: e.content });
      }
    }

    if (options?.maxContextTokens && options.maxContextTokens > 0) {
      return this.trimToTokens(messages, options.maxContextTokens);
    }
    return messages;
  }

  /**
   * Compaction: вставить summary-маркер в конец лога (история НЕ удаляется, а отмечается).
   * `replacedRange` — диапазон событий [start, end), которые сжимает этот маркер.
   */
  compact(sessionId: string, summary: string): void {
    const list = this.logs.get(sessionId) ?? [];
    let lastSummaryIdx = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].type === 'summary') lastSummaryIdx = i;
    }
    this.append({
      sessionId,
      ts: Date.now(),
      type: 'summary',
      content: summary,
      replacedRange: [lastSummaryIdx + 1, list.length],
    });
  }

  /** Обрезать сообщения по токенам: сохраняем summary (первое system) + самые свежие */
  private trimToTokens(messages: ChatMessage[], maxContextTokens: number): ChatMessage[] {
    const hasSummary = messages.length > 0 && messages[0].role === 'system';
    const prefix = hasSummary ? [messages[0]] : [];
    const body = hasSummary ? messages.slice(1) : messages;

    let used = prefix.reduce((s, m) => s + this.estimateTokens(m.content), 0);
    const kept: ChatMessage[] = [];
    for (let i = body.length - 1; i >= 0; i--) {
      const tokens = this.estimateTokens(body[i].content);
      if (used + tokens > maxContextTokens) break;
      used += tokens;
      kept.unshift(body[i]);
    }
    return [...prefix, ...kept];
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
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
