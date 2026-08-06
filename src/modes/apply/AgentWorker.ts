// AgentWorker — изолированный ReAct-агент для multi-agent оркестрации (задача MA-1)
// В отличие от ChatViewProvider.runAgentLoop, не привязан к UI:
//   - свой systemPrompt из AgentRole
//   - свой allow-list инструментов
//   - свой провайдер/модель
//   - колбэк onStep вместо postMessage
//   - возвращает структурированный результат

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';
import { getToolSchemas, getTool } from '../chat/ChatAgentTools';
import { ContextSummarizer } from '../../shared/ContextSummarizer';
import { isConfirmationRequired } from './ToolAllowList';
import { loadRoleAgentsMd } from '../../shared/RoleAgentsMdLoader';

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
  /** Потраченные токены (оценка) */
  inputTokens: number;
  outputTokens: number;
  /** Ошибка, если агент упал */
  error?: string;
}

/**
 * AgentWorker — изолированный агент, запускаемый оркестратором.
 *
 * Создаёт свой массив messages[], запускает ReAct-цикл с инструментами,
 * фильтрует инструменты по AgentRole.allowedTools, использует указанную модель.
 */
export class AgentWorker {
  /** Роль агента */
  readonly role: AgentRole;
  /** Провайдер LLM */
  private provider: any;
  /** Максимальное число итераций */
  private readonly maxIterations: number;
  /** Колбэк для логирования шагов */
  private onStep?: (step: AgentStep) => void;

  constructor(
    role: AgentRole,
    provider: any,
    maxIterations: number = 10,
    onStep?: (step: AgentStep) => void,
  ) {
    this.role = role;
    this.provider = provider;
    this.maxIterations = maxIterations;
    this.onStep = onStep;
  }

  /**
   * Запустить агента с задачей.
   *
   * @param task — текст задачи (user message)
   * @returns WorkerResult — ответ, шаги, токены
   */
  async run(task: string): Promise<WorkerResult> {
    const steps: AgentStep[] = [];
    const emit = (step: AgentStep): void => {
      steps.push(step);
      this.onStep?.(step);
    };

    // Определяем модель
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = this.role.model || config.get<string>('defaultModel') || 'gpt-4o';

    // Получаем схемы инструментов и фильтруем по allowedTools
    const allToolSchemas = getToolSchemas();
    const toolSchemas = this.role.allowedTools?.length
      ? allToolSchemas.filter((t: any) => this.role.allowedTools!.includes(t.function.name))
      : allToolSchemas;

    emit({ iteration: 0, type: 'info', message: `Worker '${this.role.name}' запущен. Задача: ${task.slice(0, 80)}... Модель: ${model}, Инструменты: ${toolSchemas.map((t: any) => t.function.name).join(', ')}` });

    // Формируем системный промпт с информацией об инструментах
    const toolDescriptions = toolSchemas.map((t: any) =>
      `- ${t.function.name}: ${t.function.description}`).join('\n');

    const systemPrompt = `${this.role.systemPrompt}\n\n## Доступные инструменты:\n${toolDescriptions}\n\nИспользуй инструменты по одному за шаг. Отвечай кратко, по-русски.`;

    // --- MA-5: Role-based AGENTS.md ---
    const roleAgentsMd = loadRoleAgentsMd(this.role.name);
    const finalSystemPrompt = roleAgentsMd
      ? `${systemPrompt}\n\n## Правила роли (AGENTS.${this.role.name}.md):\n${roleAgentsMd}`
      : systemPrompt;

    // История сообщений: system + user task
    const messages: any[] = [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: task },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    let finalAnswer = '';
    const summarizer = new ContextSummarizer();

    // ReAct-цикл
    for (let i = 1; i <= this.maxIterations; i++) {
      emit({ iteration: i, type: 'info', message: `Шаг ${i}: запрос к LLM...` });

      // Оценка входных токенов
      const inTok = messages.reduce((s, m) => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
        return s + text.length;
      }, 0) / 4;
      inputTokens += Math.ceil(inTok);

      try {
        // Вызов LLM с инструментами
        const response = await this.provider.createWithTools(
          messages, model, toolSchemas,
        );

        const choice = response.choices?.[0];
        if (!choice) {
          emit({ iteration: i, type: 'error', message: 'Пустой ответ от LLM' });
          break;
        }

        const toolCalls = choice.message?.tool_calls;

        // Нет tool calls — финальный ответ
        if (!toolCalls || toolCalls.length === 0) {
          const content = choice.message?.content || '';
          outputTokens += Math.ceil(content.length / 4);
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

          const tool = getTool(toolName);
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
      } catch (e: any) {
        emit({ iteration: i, type: 'error', message: `Ошибка LLM: ${e.message}` });
        const errMsg = e.message || String(e);
        // Пробрасываем ошибку наверх — оркестратор должен знать о падении воркера
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
    };
  }
}
