// CodeReviewer — standalone AI-ревью кода (P2).
// Выделен из Plan Mode reflect(): там ревьюер проверяет AC плана, здесь — произвольный код.
// Запускает ReviewerAgent (ReAct через AgentWorker) с инструментами read_file/search_files/list_files.

import { AgentWorker, AgentRole } from '../apply/AgentWorker';

/** Результат код-ревью */
export interface CodeReviewResult {
  /** Markdown-отчёт ревьюера */
  report: string;
  /** Сколько итераций потратил агент */
  iterations: number;
  /** Стоимость вызова */
  cost: number;
}

/** Директивный системный промпт ревьюера (для ReAct-агента, реально читает файлы) */
const CODE_REVIEW_SYSTEM_PROMPT = `Ты — код-ревьюер. Твоя задача — найти проблемы в коде и составить структурированный отчёт.

1. Прочитай указанный файл через read_file (путь будет в задаче) — либо код уже передан в задаче.
2. При необходимости найди связанные файлы через search_files/list_files.
3. Проанализируй по секциям:
   - Стиль: именование, форматирование, читаемость, комментарии
   - Безопасность: уязвимости, инъекции, утечки, гонки
   - Корректность: ошибки, граничные случаи, обработка исключений
   - Оптимизация: лишние вычисления, сложность, узкие места
4. Составь отчёт: список замечаний по приоритету (🔴 критично / 🟠 важно / 🟡 мелко), markdown, по-русски.

НЕ ИСПРАВЛЯЙ код — только докладывай.`;

/**
 * CodeReviewer — запускает standalone ReviewerAgent для ревью файла или сырого кода.
 */
export class CodeReviewer {
  /** Ревью файла по абсолютному пути (агент читает файл инструментом read_file) */
  async reviewFile(
    filePath: string,
    provider: any,
    model: string,
    signal?: AbortSignal,
  ): Promise<CodeReviewResult> {
    if (!filePath || !filePath.trim()) {
      return { report: 'Ошибка: путь к файлу не указан', iterations: 0, cost: 0 };
    }
    const task = `Проведи код-ревью файла.\n\nФайл: ${filePath}\n\nПрочитай файл через read_file и составь отчёт.`;
    return this.runReview(provider, model, task, signal);
  }

  /** Ревью сырого кода (выделение/дифф) — код передаётся в задачу напрямую */
  async reviewCode(
    code: string,
    language: string,
    filePath: string,
    provider: any,
    model: string,
    signal?: AbortSignal,
  ): Promise<CodeReviewResult> {
    if (!code || !code.trim()) {
      return { report: 'Ошибка: нет кода для ревью', iterations: 0, cost: 0 };
    }
    const task = [
      'Проведи код-ревью следующего кода.',
      '',
      `Файл: ${filePath || '(выделение)'}`,
      `Язык: ${language || 'неизвестно'}`,
      '',
      '```' + (language || '') + '\n' + code + '\n```',
    ].join('\n');
    return this.runReview(provider, model, task, signal);
  }

  /** Общий запуск ReviewerAgent */
  private async runReview(
    provider: any,
    model: string,
    task: string,
    signal?: AbortSignal,
  ): Promise<CodeReviewResult> {
    const role: AgentRole = {
      // Имя 'reviewer' — AgentWorker сам подхватит правила из .llma/agents/reviewer.md
      // (loadRoleAgentsMd) и допишет их к CODE_REVIEW_SYSTEM_PROMPT
      name: 'reviewer',
      systemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
      allowedTools: ['read_file', 'search_files', 'list_files'],
      model,
    };

    const worker = new AgentWorker(role, provider, {
      maxIterations: 8,
      skipGlobalAllowList: true,
      signal,
    });

    const result = await worker.run(task);
    return {
      report: result.answer,
      iterations: result.iterations,
      cost: result.cost,
    };
  }
}
