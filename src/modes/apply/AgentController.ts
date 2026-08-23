// Контроллер агента для Apply Mode
// Реализует ReAct-цикл: system prompt → LLM → tool_call → execute → observe → repeat → финальный ответ
// CancellationToken, maxIterations=20 (конфигурируется через settings)
// Слой 04 Context Management: summary для длинных ReAct-сессий (>10 шагов)

import * as vscode from 'vscode';
import { ChatMessage, LLMProvider } from '../../providers/types';
import { ToolSystem } from './ToolSystem';
import { loadAgentsMd } from '../../shared/AgentsMdLoader';
import { ContextSummarizer } from '../../shared/ContextSummarizer';
import { buildThinkingExtraBody } from '../../shared/thinking';

/**
 * Системный промпт для ReAct-агента (из PLAN.md, секция «System Prompt для ReAct-агента»).
 * Плейсхолдеры {maxIterations} и {toolsDescription} подставляются при формировании запроса.
 */
const SYSTEM_PROMPT_TEMPLATE = `Ты — AI-ассистент для программирования, встроенный в VS Code.
Твоя задача — помогать пользователю с кодом: писать, читать, изменять, искать, запускать команды.

У тебя есть набор инструментов (tools). Для каждого шага:
1. Проанализируй текущую ситуацию (что уже сделано, что ещё нужно)
2. Если нужно действие — вызови соответствующий инструмент
3. После получения результата проанализируй его и реши, нужен ли ещё шаг
4. Когда задача полностью выполнена — верни финальный ответ со сводкой всех изменений

Правила:
- Не вызывай инструменты без необходимости
- Если инструмент вернул ошибку — попробуй другой подход
- Пользователь может отменить выполнение в любой момент
- Максимум шагов: {maxIterations}. Если не уложился — заверши с сообщением о превышении лимита
- Используй русский язык для ответов пользователю
- Имена переменных/функций в коде — на английском, комментарии — на русском

Доступные инструменты:
{toolsDescription}

Формат ответа (строго):
- Если нужно выполнить действие — верни ТОЛЬКО JSON-объект вида: {"tool": "<имя инструмента>", "arguments": { ... }}
- Если задача выполнена — верни финальный ответ обычным текстом (без JSON)`;

/**
 * Один шаг ReAct-цикла: информация для лога (прогресс в WebView).
 */
export interface AgentStep {
  /** Номер итерации ReAct-цикла (1-based, 0 = служебные сообщения) */
  iteration: number;
  /** Тип шага */
  type: 'tool_call' | 'tool_result' | 'answer' | 'error' | 'info';
  /** Имя вызванного инструмента (для tool_call / tool_result) */
  tool?: string;
  /** Аргументы вызова инструмента */
  args?: unknown;
  /** Результат выполнения инструмента */
  result?: string;
  /** Текстовое сообщение (для answer / error / info) */
  message?: string;
}

/**
 * Опции запуска ReAct-агента.
 */
export interface AgentRunOptions {
  /** Провайдер LLM для отправки запросов */
  provider: LLMProvider;
  /** Имя модели (например, 'gpt-4o', 'deepseek-chat') */
  model: string;
  /** Задача пользователя — что нужно сделать */
  task: string;
  /** Максимум итераций ReAct-цикла (по умолчанию 20, читается из настроек) */
  maxIterations?: number;
  /** Сигнал отмены (CancellationToken через AbortController) */
  signal?: AbortSignal;
  /** Колбэк на каждый шаг (для лога шагов в WebView) */
  onStep?: (step: AgentStep) => void;
}

/**
 * Результат выполнения ReAct-агента.
 */
export interface AgentResult {
  /** Финальный ответ агента (текст или описание выполненной работы) */
  answer: string;
  /** Все шаги цикла (для лога в WebView) */
  steps: AgentStep[];
  /** Сколько итераций выполнено */
  iterations: number;
  /** Превышен ли лимит шагов */
  limitExceeded: boolean;
  /** Отменён ли пользователем */
  cancelled: boolean;
}

/**
 * AgentController — управляет ReAct-циклом агента.
 *
 * Жизненный цикл:
 * 1. Получает задачу пользователя
 * 2. Формирует system prompt с описанием инструментов
 * 3. Цикл (до maxIterations):
 *    a. LLM → ответ (содержит JSON-вызов инструмента или финальный текст)
 *    b. Если вызов инструмента → выполняет через ToolSystem → результат в историю
 *    c. Если финальный ответ → возвращает результат
 * 4. CancellationToken для отмены пользователем
 * 5. WebView-лог через onStep callback
 * 6. Слой 04: если шагов > 10 и история большая — сжимает первые шаги в summary
 */
export class AgentController {
  /** Реестр инструментов */
  private readonly toolSystem: ToolSystem;
  /** Суммаризатор для сжатия длинной истории */
  private readonly summarizer: ContextSummarizer = new ContextSummarizer();

  /** Порог шагов, после которого запускается summary */
  private static readonly SUMMARY_STEP_THRESHOLD = 1;

  constructor(toolSystem: ToolSystem) {
    this.toolSystem = toolSystem;
  }

  /**
   * Запустить ReAct-цикл агента.
   *
   * @param options — параметры запуска (провайдер, модель, задача, ...)
   * @returns AgentResult — финальный ответ и лог шагов
   */
  async run(options: AgentRunOptions): Promise<AgentResult> {
    const maxIterations = options.maxIterations ?? this.getMaxIterationsFromConfig();
    const steps: AgentStep[] = [];
    const emit = (step: AgentStep): void => {
      steps.push(step);
      options.onStep?.(step);
    };

    // Читаем настройки summary
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const summaryEnabled = config.get<boolean>('chat.summaryEnabled', true);
    const summaryModel = config.get<string>('chat.summaryModel', '') ||
      config.get<string>('agent.model', '') ||
      options.model;

    emit({ iteration: 0, type: 'info', message: `Агент запущен. Максимум шагов: ${maxIterations}` });

    // Формируем системный промпт с подстановкой лимита и описания инструментов
    let systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{maxIterations}', String(maxIterations))
      .replace('{toolsDescription}', this.toolSystem.getToolsDescription());

    // Автоинжект AGENTS.md (слой 01 System Policy)
    const agentsMd = await loadAgentsMd();
    if (agentsMd) {
      systemPrompt += `\n\n## Правила проекта (AGENTS.md):\n${agentsMd}`;
    }

    // История сообщений для LLM: system + user
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: options.task },
    ];

    let iterations = 0;
    /** Было ли уже применено summary (только один раз за сессию) */
    let summaryApplied = false;

    try {
      for (let i = 1; i <= maxIterations; i++) {
        iterations = i;

        // Проверка отмены пользователем
        if (options.signal?.aborted) {
          emit({ iteration: i, type: 'error', message: 'Выполнение отменено пользователем' });
          return {
            answer: 'Выполнение отменено пользователем.',
            steps,
            iterations,
            limitExceeded: false,
            cancelled: true,
          };
        }

        // --- Слой 04: Summary для длинных ReAct-сессий ---
        // Если шагов > порога, история большая, и summary ещё не применялось —
        // сжимаем первые N шагов в summary и вставляем как системное сообщение
        const debug = config.get<boolean>('debug', false);
        if (
          summaryEnabled &&
          !summaryApplied &&
          i > AgentController.SUMMARY_STEP_THRESHOLD &&
          messages.length > AgentController.SUMMARY_STEP_THRESHOLD * 2
        ) {
          if (debug) {
            console.warn(`[LLM Assistant] Agent summary trigger: i=${i}, threshold=${AgentController.SUMMARY_STEP_THRESHOLD}, messages=${messages.length}, minMessages=${AgentController.SUMMARY_STEP_THRESHOLD * 2}`);
          }
          await this.applySummary(messages, options, summaryModel, emit);
          summaryApplied = true;
        } else if (debug && i === AgentController.SUMMARY_STEP_THRESHOLD + 1) {
          console.warn(`[LLM Assistant] Agent summary CHECK: enabled=${summaryEnabled}, applied=${summaryApplied}, i=${i}>${AgentController.SUMMARY_STEP_THRESHOLD}=${i > AgentController.SUMMARY_STEP_THRESHOLD}, messages=${messages.length}>${AgentController.SUMMARY_STEP_THRESHOLD * 2}=${messages.length > AgentController.SUMMARY_STEP_THRESHOLD * 2}`);
        }

        emit({ iteration: i, type: 'info', message: `Шаг ${i}: запрос к LLM...` });

        // 1. Отправляем историю в LLM и собираем полный ответ из стрима
        const responseText = await this.collectResponse(options, messages);

        if (options.signal?.aborted) {
          emit({ iteration: i, type: 'error', message: 'Выполнение отменено пользователем' });
          return {
            answer: 'Выполнение отменено пользователем.',
            steps,
            iterations,
            limitExceeded: false,
            cancelled: true,
          };
        }

        // 2. Пытаемся распарсить ответ как JSON-вызов инструмента
        const toolCall = this.parseToolCall(responseText);

        if (toolCall) {
          // 3a. Вызов инструмента
          emit({ iteration: i, type: 'tool_call', tool: toolCall.name, args: toolCall.arguments });

          const result = await this.toolSystem.execute(toolCall.name, toolCall.arguments);

          emit({ iteration: i, type: 'tool_result', tool: toolCall.name, result });

          // Добавляем в историю: ответ ассистента (с JSON) + результат (observation)
          messages.push({ role: 'assistant' as const, content: responseText });
          messages.push({ role: 'user' as const, content: result });

          // Продолжаем цикл — LLM получит observation и решит, нужен ли ещё шаг
        } else {
          // 3b. Финальный ответ — задача выполнена
          emit({ iteration: i, type: 'answer', message: responseText });
          return {
            answer: responseText,
            steps,
            iterations,
            limitExceeded: false,
            cancelled: false,
          };
        }
      }

      // Лимит шагов исчерпан — задача не завершена
      const limitMessage = `Превышен лимит шагов (${maxIterations}). Задача не завершена.`;
      emit({ iteration: maxIterations, type: 'error', message: limitMessage });
      return {
        answer: limitMessage,
        steps,
        iterations,
        limitExceeded: true,
        cancelled: false,
      };
    } catch (err) {
      // Любая неожиданная ошибка (сеть, провайдер, файловая система)
      const message = err instanceof Error ? err.message : String(err);
      emit({ iteration: iterations, type: 'error', message: `Ошибка: ${message}` });
      return {
        answer: `Ошибка выполнения: ${message}`,
        steps,
        iterations,
        limitExceeded: false,
        cancelled: false,
      };
    }
  }

  /**
   * Сжать первые N шагов ReAct-истории в summary и заменить их.
   * Оставляет system-сообщение, вставляет summary вторым сообщением,
   * и сохраняет последние несколько шагов для контекста.
   */
  private async applySummary(
    messages: ChatMessage[],
    options: AgentRunOptions,
    summaryModel: string,
    emit: (step: AgentStep) => void,
  ): Promise<void> {
    try {
      const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);

      // Берём первые шаги (пропускаем system + user task)
      // Индексы: 0 = system, 1 = user task, 2+ = диалог агента
      const keepRecent = 2; // Оставляем последнюю пару (assistant + tool_result)
      const totalToKeep = 2 + keepRecent; // system + task + recent

      if (messages.length <= totalToKeep) {
        if (debug) console.warn(`[LLM Assistant] Agent applySummary SKIP: messages=${messages.length} <= ${totalToKeep}`);
        return; // Недостаточно сообщений для сжатия
      }

      const messagesToCompress = messages.slice(2, messages.length - keepRecent);

      if (messagesToCompress.length === 0) {
        return;
      }

      emit({
        iteration: 0,
        type: 'info',
        message: `Сжатие истории ReAct (${messagesToCompress.length} сообщений) в summary...`,
      });

      if (debug) console.warn(`[LLM Assistant] Agent applySummary: compressing ${messagesToCompress.length} messages, model=${summaryModel}`);

      const summary = await this.summarizer.summarizeMessages(
        messagesToCompress,
        options.provider,
        summaryModel,
      );

      if (summary) {
        if (debug) console.warn(`[LLM Assistant] Agent applySummary: summary OK (${summary.length} chars), rebuilding messages...`);

        // Заменяем историю: system + summary + последние шаги
        const systemMsg = messages[0];
        const taskMsg = messages[1];
        const recentMessages = messages.slice(messages.length - keepRecent);

        // Очищаем и пересобираем массив
        messages.length = 0;
        messages.push(systemMsg);
        messages.push({
          role: 'system' as const,
          content: `## Краткое содержание предыдущих шагов:\n${summary}`,
        });
        messages.push(taskMsg);
        messages.push(...recentMessages);

        if (debug) console.warn(`[LLM Assistant] Agent applySummary: rebuilt messages=[${messages.map(m => m.role).join(', ')}], total=${messages.length}`);

        emit({
          iteration: 0,
          type: 'info',
          message: `История сжата: оставлено ${messages.length} сообщений`,
        });
      }
    } catch (err) {
      // Если сжатие не удалось — продолжаем без него
      const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
      if (debug) console.warn('[LLM Assistant] Agent applySummary ERROR:', err);
    }
  }

  /**
   * Собрать полный ответ LLM из стрима (AsyncIterable<string> → строка).
   * Использует provider.chat() с stream: true.
   */
  private async collectResponse(
    options: AgentRunOptions,
    messages: ChatMessage[]
  ): Promise<string> {
    const chunks: string[] = [];
    const stream = options.provider.chat(
      messages,
      {
        model: options.model,
        temperature: 0,       // Минимальная температура для детерминированного выбора инструментов
        maxTokens: 4096,      // Достаточно для JSON с аргументами инструмента
        stream: true,
        extraBody: buildThinkingExtraBody(options.model),
      },
      options.signal
    );
    for await (const chunk of stream) {
      if (options.signal?.aborted) break;
      chunks.push(chunk);
    }
    return chunks.join('');
  }

  /**
   * Распарсить ответ LLM: JSON-вызов инструмента или финальный ответ.
   *
   * Ищет JSON-объект вида: {"tool": "<имя>", "arguments": { ... }}
   * Поддерживает:
   * - JSON в markdown-код-блоке (```json ... ```)
   * - JSON, встроенный в текст (находит первую { и последнюю })
   * - arguments как объект или как строка (парсит строку)
   *
   * @param responseText — полный текст ответа LLM
   * @returns распарсенный вызов инструмента или null (финальный ответ)
   */
  parseToolCall(responseText: string): { name: string; arguments: unknown } | null {
    const text = responseText.trim();

    // Если ответ обёрнут в markdown-код-блок — снимаем обёртку
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1].trim() : text;

    // Пытаемся распарсить как JSON целиком
    const tryParse = (input: string): unknown | null => {
      try {
        return JSON.parse(input);
      } catch {
        return null;
      }
    };

    let parsed = tryParse(candidate);

    // Если не удалось — ищем JSON, встроенный в текст (от { до последней })
    if (!parsed) {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start !== -1 && end > start) {
        parsed = tryParse(candidate.slice(start, end + 1));
      }
    }

    if (!parsed || typeof parsed !== 'object' || parsed === null) {
      return null; // Это финальный ответ текстом
    }

    const obj = parsed as Record<string, unknown>;
    const name = obj['tool'];

    // Проверяем, что имя инструмента существует в реестре
    if (typeof name !== 'string' || !this.toolSystem.getTool(name)) {
      return null; // Не похоже на вызов инструмента — считаем финальным ответом
    }

    const argumentsValue = obj['arguments'] ?? {};

    // arguments может прийти строкой JSON — парсим
    if (typeof argumentsValue === 'string') {
      try {
        return { name, arguments: JSON.parse(argumentsValue) };
      } catch {
        // Если распарсить не удалось — передаём как строку
        return { name, arguments: argumentsValue };
      }
    }

    return { name, arguments: argumentsValue };
  }

  /**
   * Прочитать максимальное число шагов из настроек VS Code.
   * @returns число итераций (по умолчанию 20)
   */
  private getMaxIterationsFromConfig(): number {
    return vscode.workspace.getConfiguration('llmAssistant').get<number>('apply.maxIterations') ?? 20;
  }
}
