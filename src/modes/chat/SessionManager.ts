// SessionManager — управление сессиями чата
// Хранит список сессий в workspaceState, переключает активную сессию

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';

/** Метаданные сессии */
export interface SessionMeta {
  id: string;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

/** Полные данные сессии */
export interface Session {
  meta: SessionMeta;
  messages: ChatMessage[];
}

const SESSIONS_KEY = 'llmAssistant.chat.sessions';
const ACTIVE_KEY = 'llmAssistant.chat.activeSession';

export class SessionManager {
  private storage: vscode.Memento;
  private sessions: Map<string, Session> = new Map();
  private activeId: string | null = null;

  constructor(storage: vscode.Memento) {
    this.storage = storage;
    this.load();
    // Если нет сессий — создаём первую
    if (this.sessions.size === 0) {
      this.createSession('Сессия 1');
    }
  }

  /** Получить список метаданных всех сессий (для UI) */
  listSessions(): SessionMeta[] {
    return [...this.sessions.values()]
      .map(s => s.meta)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /** Получить активную сессию */
  getActive(): Session | undefined {
    if (!this.activeId) return undefined;
    return this.sessions.get(this.activeId);
  }

  /** Получить сообщения активной сессии */
  getMessages(): ChatMessage[] {
    return this.getActive()?.messages ?? [];
  }

  /** Добавить сообщение в активную сессию */
  addMessage(message: ChatMessage): void {
    if (this.activeId) this.addMessageTo(this.activeId, message);
  }

  /** Добавить сообщение в конкретную сессию (по id) — @deprecated (F1 5d): сообщения в session-log */
  addMessageTo(sessionId: string, message: ChatMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages.push(message);
    session.meta.messageCount = session.messages.length;
    session.meta.lastActiveAt = Date.now();
    if (session.messages.length > 100) {
      session.messages = session.messages.slice(-100);
    }
    this.save();
  }

  /** Обновить meta (lastActiveAt + messageCount) без хранения messages — F1 5d. */
  touchSession(sessionId: string, messageCount: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.meta.lastActiveAt = Date.now();
    s.meta.messageCount = messageCount;
    this.save();
  }

  /** Переключиться на сессию */
  switchTo(id: string): void {
    if (this.sessions.has(id)) {
      this.activeId = id;
      this.storage.update(ACTIVE_KEY, id);
    }
  }

  /** Создать новую сессию с авто-именем */
  createSession(name?: string): string {
    // crypto.randomUUID() — гарантирует уникальность даже при быстрых вызовах
    // Date.now() может дать одинаковый timestamp в пределах одной миллисекунды
    const id = `session_${crypto.randomUUID()}`;
    const sessionName = name ?? `Новая сессия`;
    const session: Session = {
      meta: {
        id,
        name: sessionName,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: 0,
      },
      messages: [],
    };
    this.sessions.set(id, session);
    this.activeId = id;
    this.storage.update(ACTIVE_KEY, id);
    this.save();
    return id;
  }

  /** Создать копию сессии (fork/resume) с новым id и переключиться на неё. */
  duplicateSession(sourceId: string, messageCount?: number): string | undefined {
    const source = this.sessions.get(sourceId);
    if (!source) return undefined;
    const targetId = `session_${crypto.randomUUID()}`;
    const copy: Session = {
      meta: {
        id: targetId,
        name: `${source.meta.name} (копия)`,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: messageCount ?? source.messages.length,
      },
      messages: [...source.messages],
    };
    this.sessions.set(targetId, copy);
    this.activeId = targetId;
    this.storage.update(ACTIVE_KEY, targetId);
    this.save();
    return targetId;
  }

  /** Переименовать сессию */
  renameSession(id: string, name: string): void {
    const s = this.sessions.get(id);
    if (s) { s.meta.name = name; this.save(); }
  }

  /** Авто-имя из первого сообщения пользователя (контент передаётся извне — F1 5d) */
  autoNameSession(id: string, firstUserContent?: string): void {
    const s = this.sessions.get(id);
    if (!s || s.meta.name !== 'Новая сессия') return;
    const text = firstUserContent ?? s.messages.find(m => m.role === 'user')?.content;
    if (text) {
      s.meta.name = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      this.save();
    }
  }

  /** Удалить сессию */
  deleteSession(id: string): boolean {
    if (this.sessions.size <= 1) {
      // Последняя сессия: удаляем и автосоздаём новую пустую
      this.sessions.delete(id);
      this.createSession();
      this.save();
      return true;
    }
    const deleted = this.sessions.delete(id);
    if (deleted && this.activeId === id) {
      // Переключаемся на последнюю оставшуюся
      const remaining = [...this.sessions.keys()];
      this.activeId = remaining[remaining.length - 1];
      this.storage.update(ACTIVE_KEY, this.activeId);
    }
    this.save();
    return deleted;
  }

  /** Удалить все сессии, создать одну свежую. */
  clearAll(): void {
    this.sessions.clear();
    this.activeId = null;
    this.createSession();
  }

  /** Очистить активную сессию */
  clearActive(): void {
    const session = this.getActive();
    if (session) {
      session.messages = [];
      session.meta.messageCount = 0;
      this.save();
    }
  }

  private load(): void {
    try {
      const saved = this.storage.get<Record<string, Session>>(SESSIONS_KEY, {});
      for (const [id, session] of Object.entries(saved)) {
        this.sessions.set(id, session);
      }
      this.activeId = this.storage.get<string>(ACTIVE_KEY) ?? null;
      if (!this.activeId || !this.sessions.has(this.activeId)) {
        const ids = [...this.sessions.keys()];
        this.activeId = ids.length > 0 ? ids[ids.length - 1] : null;
      }
    } catch (err) {
      console.error('[SessionManager] Ошибка загрузки, сброс:', err);
      this.sessions.clear();
      this.activeId = null;
    }
  }

  private save(): void {
    const obj: Record<string, Session> = {};
    for (const [id, session] of this.sessions) {
      obj[id] = session;
    }
    this.storage.update(SESSIONS_KEY, obj);
  }
}
