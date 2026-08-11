// AgentWorker — изолированный ReAct-агент для multi-agent оркестрации и чат-агента (задача MA-1)
// Общий движок для:
//   - runAgentLoop (чат-агент) — с подтверждениями, MCP, summary, историей
//   - оркестратора — headless, без подтверждений
//
// Отличия от ChatViewProvider.runAgentLoop:
//   - свой systemPrompt из AgentRole
//   - свой allow-list инструментов
//   - колбэк onStep вместо postMessage
//   - возвращает структурированный результат

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';
import { getToolSchemas, getTool, getToolSchemasUnfiltered, getToolUnfiltered } from '../chat/ChatAgentTools';
import { ContextSummarizer } from '../../shared/ContextSummarizer';
import { loadRoleAgentsMd, getSkillTemplate } from '../../shared/RoleAgentsMdLoader';
import { calculateCost } from '../../providers/types';

/**
 * Роль агента: определяет поведение, доступные инструменты и модель.
 */
export interface AgentRole {
  /** Уникальное имя роли (coder, reviewer, architect) */
  name: string;
  /** Системный промпт — определяет поведение агента */
  systemPrompt: string;
  /** Разрешённые инструменты (имена). Пустой массив = все доступны */
  allowedTools?: string[];
  /** Модель для этого воркера (если не указана — используется глобальная) */
  model?: string;
}

/**
 * Один шаг ReAct-цикла.
 */
export interface AgentStep {
  iteration: number;
  type: 'info' | 'tool_call' | 'tool_result' | 'response' | 'error';
  message: string;
  toolName?: string;
  toolResult?: string;
}

/**
 * Результат работы воркера.
 */
export interface WorkerResult {
  /** Финальный ответ агента (текст) */
  answer: string;
  /** Все шаги выполнения */
  steps: AgentStep[];
  /** Количество итераций */
  iterations: number;
  /** Потраченные токены (оценка или из usage API) */
  inputTokens: number;
  outputTokens: number;
  /** Стоимость в USD */
  cost: number;
  /** Ошибка, если агент упал */
  error?: string;
}

/**
 * Опции конструктора AgentWorker.
 */
export interface AgentWorkerOptions {
  /** Максимальное число итераций (по умолчанию 10) */
  maxIterations?: number;
  /** Колбэк для логирования шагов */
  onStep?: (step: AgentStep) => void;
  /** Дополнительные инструменты (MCP) — добавляются к базовым из ChatAgentTools */
  extraTools?: Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  /** Колбэк для подтверждения опасных операций (write_file, run_terminal).
   *  Если не передан — все операции выполняются без подтверждения. */
  onConfirm?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Включить сжатие длинной истории (summary) в цикле */
  enableSummary?: boolean;
  /** AbortSignal для отмены выполнения */
  signal?: AbortSignal;
  /** Пропустить глобальный allow-list (для Plan Mode и оркестратора, где фильтрация через role.allowedTools) */
  skipGlobalAllowList?: boolean;
}

/**
 * AgentWorker — изолированный агент, общий движок для чат-агента и оркестратора.
 *
 * Поддерживает:
 *   - Дополнительные инструменты (MCP) через extraTools
 *   - Подтверждение операций через onConfirm
 *   - Сжатие истории (summary) при включённом enableSummary
 *   - Передачу готового массива сообщений через initialMessages (для runAgentLoop)
 */
export class AgentWorker {
  /** Роль агента */
  readonly role: AgentRole;
  /** Провайдер LLM */
  private provider: any;
  /** Опции */
  private options: AgentWorkerOptions;

  constructor(
    role: AgentRole,
    provider: any,
    options: AgentWorkerOptions = {},
  ) {
    this.role = role;
    this.provider = provider;
    this.options = {
      maxIterations: 10,
      ...options,
    };
  }

  /**
   * Запустить агента с задачей.
   *
   * @param task — текст задачи (user message)
   * @param initialMessages — готовый массив сообщений (используется runAgentLoop вместо построения с нуля)
   * @returns WorkerResult — ответ, шаги, токены
   */
  async run(task: string, initialMessages?: any[]): Promise<WorkerResult> {
    const steps: AgentStep[] = [];
    const emit = (step: AgentStep): void => {
      steps.push(step);
      this.options.onStep?.(step);
    };

    // Определяем модель
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = this.role.model || config.get<string>('defaultModel') || 'gpt-4o';

    // Получаем схемы инструментов: unfiltered для Plan Mode/оркестратора, filtered для чат-агента
    const baseToolSchemas = this.options.skipGlobalAllowList
      ? getToolSchemasUnfiltered()
      : getToolSchemas();
    const extraTools = this.options.extraTools || [];
    const allToolSchemas = [...baseToolSchemas, ...extraTools];
    const toolSchemas = this.role.allowedTools?.length
      ? allToolSchemas.filter((t: any) => this.role.allowedTools!.includes(t.function.name))
      : allToolSchemas;

    emit({ iteration: 0, type: 'info', message: `Worker '${this.role.name}' запущен. Задача: ${task.slice(0, 80)}... Модель: ${model}, Инструменты: ${toolSchemas.map((t: any) => t.function.name).join(', ')}` });

    let messages: any[];

    if (initialMessages && initialMessages.length > 0) {
      // Используем готовый массив (от runAgentLoop — история + system prompt)
      messages = [...initialMessages];
    } else {
      // Формируем системный промпт с информацией об инструментах
      const toolDescriptions = toolSchemas.map((t: any) =>
        `- ${t.function.name}: ${t.function.description}`).join('\n');

      const systemPrompt = `${this.role.systemPrompt}\n\n## Доступные инструменты:\n${toolDescriptions}\n\nИспользуй инструменты по одному за шаг. Отвечай кратко, по-русски.`;

      // --- MA-5: Role-based AGENTS.md ---
      const roleAgentsMd = loadRoleAgentsMd(this.role.name);
      const finalSystemPrompt = roleAgentsMd
        ? `${systemPrompt}\n\n## Правила роли (AGENTS.${this.role.name}.md):\n${roleAgentsMd}`
        : systemPrompt;

      // --- Системный шаблон структуры скила + каталог (для всех агентов) ---
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const workspacePath = workspaceFolder?.uri.fsPath;
      const skillTemplate = getSkillTemplate(workspacePath);
      const enrichedPrompt = skillTemplate
        ? `${finalSystemPrompt}\n\n${skillTemplate}`
        : finalSystemPrompt;

      messages = [
        { role: 'system', content: enrichedPrompt },
        { role: 'user', content: task },
      ];
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finalAnswer = '';
    const summarizer = new ContextSummarizer();
    const summaryApplied = false; // summary применяется однократно

    // ReAct-цикл
    for (let i = 1; i <= (this.options.maxIterations || 10); i++) {
      emit({ iteration: i, type: 'info', message: `Шаг ${i}: запрос к LLM...` });

      // --- Сжатие истории (если включено) ---
      const enableSummary = this.options.enableSummary || false;
      if (enableSummary && i >= 2 && messages.length > 6) {
        try {
          const systemMsg = messages[0];
          const taskMsg = messages.length > 1 ? messages[1] : null;
          const oldMessages = messages.slice(2, -4);
          const recentMessages = messages.slice(-4);
          if (oldMessages.length > 0) {
            const summary = await summarizer.summarizeMessages(oldMessages, this.provider, model);
            if (summary) {
              messages = [systemMsg];
              if (taskMsg) messages.push(taskMsg);
              messages.push({ role: 'system', content: `## Краткое содержание предыдущих шагов:\n${summary}` });
              messages.push(...recentMessages);
            }
          }
        } catch (e) {
          // Молча продолжаем без summary
        }
      }

      try {
        // Вызов LLM с инструментами
        const response = await this.provider.createWithTools(
          messages, model, toolSchemas,
          this.options.signal,
        );

        const choice = response.choices?.[0];
        if (!choice) {
          emit({ iteration: i, type: 'error', message: 'Пустой ответ от LLM' });
          break;
        }

        // Используем реальные токены из API, если доступны
        inputTokens += response.usage?.prompt_tokens ?? 0;

        const toolCalls = choice.message?.tool_calls;

        // Нет tool calls — финальный ответ
        if (!toolCalls || toolCalls.length === 0) {
          const content = choice.message?.content || '';
          // Реальные выходные токены из usage, или оценка chars/4
          outputTokens += response.usage?.completion_tokens ?? Math.ceil(content.length / 4);
          finalAnswer = content;
          emit({ iteration: i, type: 'response', message: content.slice(0, 200) });
          messages.push({ role: 'assistant', content });
          break;
        }

        // Есть tool calls — выполняем
        messages.push(choice.message);
        for (const tc of toolCalls) {
          const toolName = tc.function?.name;
          if (!toolName) continue;

          // Проверяем allow-list (на уровне воркера)
          if (this.role.allowedTools?.length && !this.role.allowedTools.includes(toolName)) {
            messages.push({
              role: 'tool', tool_call_id: tc.id,
              content: `Инструмент '${toolName}' запрещён allow-list роли '${this.role.name}'`,
            });
            emit({ iteration: i, type: 'error', message: `Инструмент ${toolName} запрещён` });
            continue;
          }

          const tool = this.options.skipGlobalAllowList
            ? getToolUnfiltered(toolName)
            : getTool(toolName);
          if (!tool) {
            messages.push({
              role: 'tool', tool_call_id: tc.id,
              content: `Инструмент '${toolName}' не найден`,
            });
            continue;
          }

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }

          // Запрос подтверждения (если передан колбэк)
          if (this.options.onConfirm) {
            const approved = await this.options.onConfirm(toolName, args);
            if (!approved) {
              messages.push({
                role: 'tool', tool_call_id: tc.id,
                content: 'Операция отклонена пользователем.',
              });
              emit({ iteration: i, type: 'error', message: `Операция ${toolName} отклонена` });
              continue;
            }
          }

          emit({ iteration: i, type: 'tool_call', message: `🔧 ${toolName}`, toolName });

          try {
            const result = await tool.execute(args);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            emit({ iteration: i, type: 'tool_result', message: result.slice(0, 200), toolName, toolResult: result });
          } catch (e: any) {
            messages.push({
              role: 'tool', tool_call_id: tc.id,
              content: `Ошибка: ${e.message}`,
            });
            emit({ iteration: i, type: 'error', message: `Ошибка ${toolName}: ${e.message}` });
          }
        }

        // Очистка инжекта: удаляем system-сообщение с ⚠️ на позиции 1
        // (инжектируется ChatViewProvider для принудительного вызова ask_user)
        if (messages.length > 1 && messages[1]?.role === 'system' && messages[1]?.content?.includes('⚠️')) {
          messages.splice(1, 1);
        }
      } catch (e: any) {
        emit({ iteration: i, type: 'error', message: `Ошибка LLM: ${e.message}` });
        const errMsg = e.message || String(e);
        throw new Error(errMsg);
      }
    }

    if (!finalAnswer) {
      finalAnswer = 'Агент не дал финального ответа (исчерпан лимит итераций).';
    }

    return {
      answer: finalAnswer,
      steps,
      iterations: steps.filter(s => s.type === 'tool_call' || s.type === 'response').length,
      inputTokens: Math.ceil(inputTokens),
      outputTokens: Math.ceil(outputTokens),
      cost: calculateCost(model, Math.ceil(inputTokens), Math.ceil(outputTokens)),
    };
  }
}
