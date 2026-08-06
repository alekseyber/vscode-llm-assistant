// AgentOrchestrator — оркестратор multi-agent выполнения (задача MA-2)
// Принимает MultiAgentTask, создаёт AgentWorker'ов,
// запускает параллельно (Promise.all) или последовательно,
// собирает результаты в MultiAgentResult.

import { AgentWorker, AgentRole, WorkerResult } from './AgentWorker';

/**
 * Стратегия выполнения.
 */
export type RunStrategy = 'parallel' | 'sequential' | 'pipeline';

/**
 * Описание multi-agent задачи.
 */
export interface MultiAgentTask {
  /** Уникальный идентификатор задачи */
  id: string;
  /** Общая цель (описание задачи для оркестратора) */
  goal: string;
  /** Роли воркеров */
  roles: AgentRole[];
  /** Стратегия запуска */
  strategy: RunStrategy;
}

/**
 * Результат одного воркера в составе оркестрации.
 */
export interface WorkerTaskResult {
  /** Имя роли */
  roleName: string;
  /** Результат WorkerResult (answer, steps, tokens) */
  result: WorkerResult;
  /** Ошибка, если воркер упал */
  error?: string;
}

/**
 * Сводный результат оркестрации.
 */
export interface MultiAgentResult {
  /** ID задачи */
  taskId: string;
  /** Стратегия */
  strategy: RunStrategy;
  /** Результаты всех воркеров */
  workers: WorkerTaskResult[];
  /** Общие затраты токенов */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Успешно ли завершилась вся задача */
  success: boolean;
  /** Сводный ответ (конкатенация ответов воркеров) */
  summary: string;
}

/**
 * AgentOrchestrator — управляет запуском нескольких AgentWorker'ов.
 *
 * Поддерживает три стратегии:
 * - parallel: все воркеры запускаются одновременно (Promise.all)
 * - sequential: каждый следующий получает результат предыдущего
 * - pipeline: sequential, но каждый работает над своим артефактом
 */
export class AgentOrchestrator {
  /** Колбэк для логирования шагов оркестратора */
  private onLog?: (msg: string) => void;

  constructor(onLog?: (msg: string) => void) {
    this.onLog = onLog;
  }

  /**
   * Выполнить multi-agent задачу.
   *
   * @param task — описание задачи (цель, роли, стратегия)
   * @param provider — провайдер LLM для воркеров
   * @returns MultiAgentResult — сводный результат
   */
  async execute(task: MultiAgentTask, provider: any): Promise<MultiAgentResult> {
    this.log(`Оркестратор '${task.id}': старт, стратегия=${task.strategy}, воркеров=${task.roles.length}`);

    const workers: WorkerTaskResult[] = [];

    switch (task.strategy) {
      case 'parallel':
        await this.runParallel(task, provider, workers);
        break;
      case 'sequential':
        await this.runSequential(task, provider, workers);
        break;
      case 'pipeline':
        await this.runPipeline(task, provider, workers);
        break;
      default:
        throw new Error(`Неизвестная стратегия: ${task.strategy}`);
    }

    const totalInputTokens = workers.reduce((s, w) => s + (w.result?.inputTokens ?? 0), 0);
    const totalOutputTokens = workers.reduce((s, w) => s + (w.result?.outputTokens ?? 0), 0);
    const success = workers.every(w => !w.error);

    const summary = workers
      .map(w => `### ${w.roleName}${w.error ? ' ❌' : ' ✅'}\n${w.error ? `Ошибка: ${w.error}` : w.result?.answer ?? '(нет ответа)'}`)
      .join('\n\n');

    this.log(`Оркестратор '${task.id}': завершён. Успех=${success}, токены: ${totalInputTokens}+${totalOutputTokens}`);

    return {
      taskId: task.id,
      strategy: task.strategy,
      workers,
      totalInputTokens,
      totalOutputTokens,
      success,
      summary,
    };
  }

  /**
   * Параллельный запуск: все воркеры стартуют одновременно.
   */
  private async runParallel(
    task: MultiAgentTask,
    provider: any,
    workers: WorkerTaskResult[],
  ): Promise<void> {
    this.log(`Параллельный запуск ${task.roles.length} воркеров...`);

    const promises = task.roles.map(async (role) => {
      const wt: WorkerTaskResult = { roleName: role.name, result: { answer: '', steps: [], iterations: 0, inputTokens: 0, outputTokens: 0 } };
      try {
        const worker = new AgentWorker(role, provider);
        wt.result = await worker.run(this.buildSubTask(task.goal, role));
        this.log(`Воркер '${role.name}': завершён (${wt.result.iterations} итераций)`);
      } catch (e: any) {
        wt.error = e.message || String(e);
        this.log(`Воркер '${role.name}': ОШИБКА — ${wt.error}`);
      }
      return wt;
    });

    const results = await Promise.all(promises);
    workers.push(...results);
  }

  /**
   * Последовательный запуск: каждый следующий получает контекст от предыдущего.
   */
  private async runSequential(
    task: MultiAgentTask,
    provider: any,
    workers: WorkerTaskResult[],
  ): Promise<void> {
    let previousResult = '';

    for (const role of task.roles) {
      const wt: WorkerTaskResult = { roleName: role.name, result: { answer: '', steps: [], iterations: 0, inputTokens: 0, outputTokens: 0 } };
      try {
        const worker = new AgentWorker(role, provider);

        // Формируем задачу с контекстом от предыдущего воркера
        let subTask = this.buildSubTask(task.goal, role);
        if (previousResult) {
          subTask = `${subTask}\n\n## Результат предыдущего этапа:\n${previousResult}`;
        }

        wt.result = await worker.run(subTask);
        previousResult = wt.result.answer;
        this.log(`Воркер '${role.name}': завершён (${wt.result.iterations} итераций)`);
      } catch (e: any) {
        wt.error = e.message || String(e);
        this.log(`Воркер '${role.name}': ОШИБКА — ${wt.error}`);
        workers.push(wt);
        break; // При ошибке в sequential — останавливаем цепочку
      }
      workers.push(wt);
    }
  }

  /**
   * Pipeline: sequential, но каждый воркер работает над своим файлом/артефактом.
   * Отличается от sequential тем, что контекст передаётся как «артефакт», а не как текст.
   */
  private async runPipeline(
    task: MultiAgentTask,
    provider: any,
    workers: WorkerTaskResult[],
  ): Promise<void> {
    const artifacts: string[] = [];

    for (const role of task.roles) {
      const wt: WorkerTaskResult = { roleName: role.name, result: { answer: '', steps: [], iterations: 0, inputTokens: 0, outputTokens: 0 } };
      try {
        const worker = new AgentWorker(role, provider);

        let subTask = this.buildSubTask(task.goal, role);
        if (artifacts.length > 0) {
          subTask = `${subTask}\n\n## Артефакты предыдущих этапов:\n${artifacts.map((a, i) => `### Этап ${i + 1}:\n${a}`).join('\n\n')}`;
        }

        wt.result = await worker.run(subTask);
        artifacts.push(wt.result.answer);
        this.log(`Воркер '${role.name}': завершён (${wt.result.iterations} итераций)`);
      } catch (e: any) {
        wt.error = e.message || String(e);
        this.log(`Воркер '${role.name}': ОШИБКА — ${wt.error}`);
        workers.push(wt);
        break;
      }
      workers.push(wt);
    }
  }

  /**
   * Сформировать подзадачу для конкретной роли на основе общей цели.
   */
  private buildSubTask(goal: string, role: AgentRole): string {
    return `## Задача (роль: ${role.name})\n\n${goal}\n\nТвоя роль: ${role.systemPrompt}`;
  }

  private log(msg: string): void {
    this.onLog?.(msg);
  }
}
