// PlanModeManager — управление режимом планирования (📋 Plan Mode)
// Этапы: планирование (PlannerAgent) → имплементация (оркестратор) → рефлексия (ReviewerAgent)

import * as path from 'path';
import * as fs from 'fs';
import { AgentWorker, AgentRole } from '../apply/AgentWorker';
import { AgentOrchestrator, MultiAgentTask, MultiAgentResult } from '../apply/AgentOrchestrator';

/** Результат этапа планирования */
export interface PlanResult {
  /** Путь к файлу плана */
  planPath: string;
  /** Содержимое плана */
  content: string;
  /** UUID плана */
  planId: string;
}

/** Результат этапа имплементации */
export interface ImplementResult {
  /** Результат оркестратора */
  orchestratorResult: MultiAgentResult;
  /** Обновлённое содержимое плана (с отмеченными AC) */
  updatedPlan?: string;
}

/** Результат этапа рефлексии */
export interface ReflectResult {
  /** Все AC выполнены */
  allPassed: boolean;
  /** Отчёт ревьюера */
  report: string;
  /** Количество циклов рефлексии */
  cycles: number;
  /** Финальный ответ */
  summary: string;
}

/** Генерация UUID v4 (простая, без зависимости) */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Системный промпт для PlannerAgent */
const PLANNER_SYSTEM_PROMPT = `Ты — архитектор-планировщик. Твоя задача — создать детальный план реализации.

ВАЖНО: пиши план СРАЗУ, не трать итерации на изучение файлов. Ты уже знаешь архитектуру проекта.

1. СРАЗУ запиши план через write_file по указанному пути
2. План должен соответствовать СТРОГОЙ структуре ниже
3. Только после записи плана, если остались итерации, прочитай затронутые файлы и уточни план

Ты НЕ пишешь код. Только план.

Структура плана (ОБЯЗАТЕЛЬНО все секции):

# План: <краткое название>
**ID:** <plan-...>
**Цель:** <одно предложение — что должно получиться>
**Дата:** <ISO timestamp>
**Контекст:** <исходный запрос>

## 📦 Затронутые компоненты
| Компонент | Файл | Тип изменения |

## 🔧 Этапы реализации
### Этап N: <название>
- [ ] Что сделать
- [ ] Файлы
- [ ] Зависимости

## ✅ Контрольные точки (AC)
| ID | Критерий | Способ проверки | Статус |

## 🔍 Инструкция для ревьюера
### Что проверять
### Критерии ОТКЛОНЕНИЯ
### Формат отчёта

## ⚠️ Риски
| Риск | Вероятность | Митигация |

## 📝 История
| Дата | Событие |

Важно: каждый пункт AC должен иметь КОНКРЕТНЫЙ способ проверки.`;

/** Системный промпт для ReviewerAgent */
const REVIEWER_SYSTEM_PROMPT = `Ты — ревьюер. Твоя задача — проверить реализацию по плану.

1. Прочитай план из указанного файла (путь будет передан в задаче)
2. Проверь КАЖДЫЙ пункт AC из таблицы «Контрольные точки»
3. Для каждого AC — используй указанный способ проверки
4. Составь отчёт в формате:

✅ AC-1: <что проверил, результат>
❌ AC-2: <что не так, конкретная команда/файл/скриншот>

НЕ ИСПРАВЛЯЙ код. Только докладывай.
Если все AC ✅ — напиши «ПЛАН ВЫПОЛНЕН ПОЛНОСТЬЮ».`;

/**
 * PlanModeManager — оркестрирует три этапа Plan Mode:
 * 1. Планирование (PlannerAgent)
 * 2. Имплементация (AgentOrchestrator: architect → coder)
 * 3. Рефлексия (ReviewerAgent)
 */
export class PlanModeManager {
  /** Путь к workspace (для .llma/plans/) */
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /** Путь к директории с планами */
  private get plansDir(): string {
    return path.join(this.workspacePath, '.llma', 'plans');
  }

  /** Обеспечить существование .llma/plans/ */
  private ensurePlansDir(): void {
    if (!fs.existsSync(this.plansDir)) {
      fs.mkdirSync(this.plansDir, { recursive: true });
    }
  }

  /**
   * Этап 1: создание плана через PlannerAgent.
   */
  async generatePlan(
    task: string,
    provider: any,
    model: string,
    signal?: AbortSignal,
  ): Promise<PlanResult> {
    this.ensurePlansDir();

    const planId = generateUUID();
    const shortId = planId.split('-')[0]; // первые 8 символов UUID
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const planFileName = `plan_${dateStr}_${shortId}.md`;
    const planPath = path.join(this.plansDir, planFileName);

    // PlannerAgent: только чтение + запись плана
    const plannerRole: AgentRole = {
      name: 'planner',
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      allowedTools: ['read_file', 'search_files', 'list_files', 'write_file'],
      model,
    };

    const planner = new AgentWorker(plannerRole, provider, {
      maxIterations: 5,  // план не требует много итераций
      enableSummary: true,
      signal,
      skipGlobalAllowList: true,  // PlannerAgent использует role.allowedTools, не глобальный
    });

    // Задача: создать план и записать в указанный путь
    const now = new Date().toISOString();
    const plannerTask = [
      `## Задача пользователя\n${task}`,
      '',
      `## Путь для сохранения плана\n${planPath}`,
      '',
      '## Инструкция',
      '1. СРАЗУ запиши план через write_file по указанному пути (не трать время на чтение файлов)',
      '2. Затем кратко сообщи что план создан',
      '3. Если остались итерации — прочитай затронутые файлы и уточни план',
      '',
      `## Важно\nИспользуй ТОЛЬКО эту дату в плане: **Дата:** ${now}`,
    ].join('\n');

    const result = await planner.run(plannerTask);

    // Читаем созданный план
    let content = '';
    try {
      content = fs.readFileSync(planPath, 'utf-8');
    } catch {
      content = result.answer || '(план не создан)';
    }

    return { planPath, content, planId };
  }

  /**
   * Этап 2: имплементация плана через оркестратор.
   */
  async implementPlan(
    planPath: string,
    provider: any,
    model: string,
    onLog?: (msg: string) => void,
  ): Promise<ImplementResult> {
    // Читаем план
    const planContent = fs.readFileSync(planPath, 'utf-8');

    // Задача для оркестратора
    const task: MultiAgentTask = {
      id: `impl_${Date.now()}`,
      goal: [
        '## Задача: реализовать план',
        '',
        `План находится в файле: ${planPath}`,
        '',
        '## Инструкция',
        '1. Architect: прочитай план, убедись что все этапы понятны',
        '2. Coder: реализуй каждый этап плана. После каждого этапа отмечай выполненные AC в плане (меняй ⬜ на ✅) через инструмент replace_in_file.',
        '3. Все изменения вноси в ФАЙЛЫ ПРОЕКТА, а не только в план.',
        '',
        '## Содержимое плана',
        planContent,
      ].join('\n'),
      roles: [
        { name: 'architect', model, allowedTools: ['read_file', 'search_files', 'list_files'], systemPrompt: 'Ты — архитектор. Проверь план на полноту и реализуемость. Если есть проблемы — сообщи.' },
        { name: 'coder', model, allowedTools: ['read_file', 'write_file', 'replace_in_file', 'search_files', 'list_files'], systemPrompt: 'Ты — разработчик. Реализуй план по этапам. После каждого этапа отмечай AC в плане. Пиши реальный код, а не описания.' },
      ],
      strategy: 'sequential',
    };

    const orchestrator = new AgentOrchestrator(onLog, undefined, undefined, { skipGlobalAllowList: true });
    const orchestratorResult = await orchestrator.execute(task, provider);

    // Читаем обновлённый план
    let updatedPlan: string | undefined;
    try {
      updatedPlan = fs.readFileSync(planPath, 'utf-8');
    } catch {
      // План не изменился
    }

    return { orchestratorResult, updatedPlan };
  }

  /**
   * Этап 3: рефлексия — ReviewerAgent проверяет результат.
   */
  async reflect(
    planPath: string,
    provider: any,
    model: string,
    maxCycles: number = 2,
    onCycle?: (cycle: number, report: string) => void,
  ): Promise<ReflectResult> {
    const reviewerRole: AgentRole = {
      name: 'reviewer',
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      allowedTools: ['read_file', 'search_files', 'list_files'],
      model,
    };

    const coderRole: AgentRole = {
      name: 'coder',
      systemPrompt: 'Ты — разработчик. Исправь замечания ревьюера. После исправления отметь AC в плане.',
      allowedTools: ['read_file', 'write_file', 'search_files', 'list_files', 'replace_in_file'],
      model,
    };

    let currentReport = '';
    let allPassed = false;
    let cycles = 0;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      cycles = cycle + 1;

      // Запускаем ревьюера
      const reviewerTask = [
        '## Задача',
        `Прочитай план из файла: ${planPath}`,
        'Проверь реализацию по ВСЕМ пунктам AC.',
        'Составь отчёт: ✅ AC-N или ❌ AC-N с деталями.',
      ].join('\n\n');

      const reviewer = new AgentWorker(reviewerRole, provider, {
        maxIterations: 8,
        skipGlobalAllowList: true,
      });
      const reviewerResult = await reviewer.run(reviewerTask);
      currentReport = reviewerResult.answer;

      onCycle?.(cycle + 1, currentReport);

      // Проверяем: есть ли ❌ в отчёте или фолбэк (ревьюер не справился)
      const hasFailures = /❌\s*AC-/.test(currentReport);
      const isFallback = /исчерпан лимит итераций|не дал финального ответа/.test(currentReport);

      if (!hasFailures && !isFallback) {
        allPassed = true;
        break;
      }

      // Если ревьюер не справился — это не ❌, но и не ✅; пробуем ещё
      if (isFallback && cycle < maxCycles - 1) continue;

      // Если есть замечания и не последний цикл — запускаем coder для исправлений
      if (cycle < maxCycles - 1) {
        const coderFixTask = [
          '## Задача: исправить замечания ревьюера',
          '',
          `План: ${planPath}`,
          '',
          '## Отчёт ревьюера',
          currentReport,
          '',
          '## Инструкция',
          '1. Исправь ВСЕ отмеченные ❌ замечания в коде проекта',
          '2. После исправления отметь AC в плане (⬜ → ✅)',
        ].join('\n');

        const coderFixer = new AgentWorker(coderRole, provider, {
          maxIterations: 8,
          skipGlobalAllowList: true,
        });
        await coderFixer.run(coderFixTask);
      }
    }

    return {
      allPassed,
      report: currentReport,
      cycles,
      summary: allPassed
        ? '🎉 ПЛАН ВЫПОЛНЕН ПОЛНОСТЬЮ — все AC ✅'
        : `⚠️ План выполнен частично (${cycles} цикл(ов) рефлексии). Невыполненные AC:\n${currentReport}`,
    };
  }
}
