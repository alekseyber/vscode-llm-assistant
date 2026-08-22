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

/** Агрегатные метрики сессии, производные из лога (SL-8) */
export interface SessionStats {
  /** Число ReAct-шагов (tool/call) */
  steps: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
  userMessages: number;
  assistantMessages: number;
  chunks: number;
}

const KEY_PREFIX = 'llmAssistant.sessionLog.';
const LEGACY_KEY = 'llmAssistant.sessionLog';
const MIGRATED_KEY = 'llmAssistant.sessionLog.migrated';
const LEGACY_SESSIONS_KEY = 'llmAssistant.chat.sessions';

/** Минимальный формат старой сессии SessionManager для миграции (SL-9) */
interface LegacySession {
  meta: { lastActiveAt: number };
  messages: ChatMessage[];
}

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
    this.migrateLegacySessions();
  }

  /** Добавить событие в конец лога. Append-only — существующие события не мутирует. */
  append(event: SessionEvent): void {
    const list = this.logs.get(event.sessionId) ?? [];
    list.push(event);
    this.logs.set(event.sessionId, list);
    this.saveSession(event.sessionId, list);
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

  /**
   * Читаемая markdown-транскрипция сессии (пользователь/ассистент/тулы/ошибки/summary).
   * Служит для экспорта и реплея: путь агента (tool/call + tool/result) виден в тексте.
   */
  toTranscript(sessionId: string): string {
    const lines: string[] = [`# Сессия: ${sessionId}`, ''];
    for (const e of this.getEvents(sessionId)) {
      switch (e.type) {
        case 'user/message':
          lines.push('## 👤 Пользователь', '', e.content, '');
          break;
        case 'assistant/message':
          lines.push('## 🤖 Ассистент', '', e.content, '');
          break;
        case 'tool/call':
          lines.push(`### 🔧 ${e.name}`, '', '```json', JSON.stringify(e.args, null, 2), '```', '');
          break;
        case 'tool/result':
          lines.push('**Результат:**', '', '```', e.result, '```', '');
          break;
        case 'error':
          lines.push('### ⚠️ Ошибка', '', e.message, '');
          break;
        case 'summary':
          lines.push(`> 📝 Краткое содержание: ${e.content}`, '');
          break;
        case 'confirm':
          lines.push(`> ✅ ${e.toolName}: ${e.accepted ? 'подтверждено' : 'отклонено'}`, '');
          break;
      }
    }
    return lines.join('\n').trim() + '\n';
  }

  /** Создать копию сессии до текущей точки (fork/resume). Опц. targetId — для согласования с SessionManager. */
  fork(sourceId: string, targetId?: string): string {
    const newId = targetId ?? `session_${crypto.randomUUID()}`;
    const source = this.logs.get(sourceId) ?? [];
    const copied = source.map(e => ({ ...e, sessionId: newId }));
    this.logs.set(newId, copied);
    this.saveSession(newId, copied);
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

  /** Производные метрики из лога — источник для RunHistoryStore (SL-8) */
  computeStats(sessionId: string): SessionStats {
    const stats: SessionStats = { steps: 0, toolCalls: 0, toolResults: 0, errors: 0, userMessages: 0, assistantMessages: 0, chunks: 0 };
    for (const e of this.getEvents(sessionId)) {
      switch (e.type) {
        case 'tool/call': stats.toolCalls++; stats.steps++; break;
        case 'tool/result': stats.toolResults++; break;
        case 'error': stats.errors++; break;
        case 'user/message': stats.userMessages++; break;
        case 'assistant/message': stats.assistantMessages++; break;
        case 'assistant/chunk': stats.chunks++; break;
      }
    }
    return stats;
  }

  /**
   * Однократная миграция старого формата SessionManager ({meta, messages[]})
   * в события session-log (SL-9). Не теряет сообщения: user/assistant → события.
   */
  migrateLegacySessions(): number {
    try {
      if (this.storage.get<string>(MIGRATED_KEY) === 'done') return 0;
      const legacy = this.storage.get<Record<string, LegacySession>>(LEGACY_SESSIONS_KEY, {});
      let migrated = 0;
      for (const [id, session] of Object.entries(legacy)) {
        if (!session?.messages?.length) continue;
        if ((this.logs.get(id) ?? []).length > 0) continue; // уже есть события — не трогаем
        const ts = session.meta?.lastActiveAt ?? Date.now();
        const events: SessionEvent[] = [];
        for (const msg of session.messages) {
          if (msg.role === 'user') {
            events.push({ sessionId: id, ts, type: 'user/message', content: msg.content });
          } else if (msg.role === 'assistant') {
            events.push({ sessionId: id, ts, type: 'assistant/message', content: msg.content });
          }
          // system и прочие роли — не часть диалога, пропускаем
        }
        if (events.length > 0) {
          this.logs.set(id, events);
          this.saveSession(id, events);
          migrated++;
        }
      }
      this.storage.update(MIGRATED_KEY, 'done');
      return migrated;
    } catch (err) {
      console.error('[SessionLog] Ошибка миграции:', err);
      return 0;
    }
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
      // Новый формат: per-session ключи `llmAssistant.sessionLog.<id>`
      for (const key of this.storage.keys()) {
        if (key.startsWith(KEY_PREFIX)) {
          const sessionId = key.slice(KEY_PREFIX.length);
          const events = this.storage.get<SessionEvent[]>(key, []);
          if (events.length > 0) {
            this.logs.set(sessionId, events);
          }
        }
      }
      // Легаси-миграция: старый единый ключ (F1-данные в прежнем формате)
      const legacy = this.storage.get<Record<string, SessionEvent[]>>(LEGACY_KEY, {});
      if (legacy && Object.keys(legacy).length > 0) {
        for (const [id, events] of Object.entries(legacy)) {
          if (!this.logs.has(id)) {
            this.logs.set(id, events);
            this.storage.update(`${KEY_PREFIX}${id}`, events);
          }
        }
        this.storage.update(LEGACY_KEY, {});
      }
    } catch (err) {
      console.error('[SessionLog] Ошибка загрузки, сброс:', err);
      this.logs.clear();
    }
  }

  private saveSession(sessionId: string, events: SessionEvent[]): void {
    this.storage.update(`${KEY_PREFIX}${sessionId}`, events);
  }
}
