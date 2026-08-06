// AgentSharedContext — общий контекст для коммуникации между воркерами (задача MA-3)
// Воркеры читают/пишут файлы в общем workspace, оркестратор координирует обмен.

/**
 * Запись в общем контексте (файл или артефакт).
 */
export interface SharedArtifact {
  /** Имя файла или ключ артефакта */
  key: string;
  /** Содержимое */
  content: string;
  /** Роль-создатель */
  createdBy: string;
  /** Временная метка */
  timestamp: number;
}

/**
 * SharedContext — реестр артефактов, доступных всем воркерам.
 * В реальном использовании артефакты — это файлы в workspace.
 * Для тестов — in-memory хранилище.
 */
export class AgentSharedContext {
  private artifacts: Map<string, SharedArtifact> = new Map();

  /**
   * Сохранить артефакт (файл) в общий контекст.
   */
  put(key: string, content: string, createdBy: string): void {
    this.artifacts.set(key, {
      key,
      content,
      createdBy,
      timestamp: Date.now(),
    });
  }

  /**
   * Получить артефакт по ключу.
   */
  get(key: string): SharedArtifact | undefined {
    return this.artifacts.get(key);
  }

  /**
   * Все артефакты.
   */
  list(): SharedArtifact[] {
    return [...this.artifacts.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Все артефакты, созданные указанной ролью.
   */
  listByRole(roleName: string): SharedArtifact[] {
    return this.list().filter(a => a.createdBy === roleName);
  }

  /**
   * Сводка всех артефактов для передачи воркеру.
   */
  summary(): string {
    const items = this.list();
    if (items.length === 0) return '(нет артефактов)';
    return items.map(a =>
      `### ${a.key} (от ${a.createdBy})\n\`\`\`\n${a.content.slice(0, 500)}\n\`\`\``
    ).join('\n\n');
  }
}
