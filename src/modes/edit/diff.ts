// Утилиты diff для Edit Mode
// Сравнение старого/нового кода, наложение декораций (зелёный/красный),
// принятие/отклонение изменений через commands

import * as vscode from 'vscode';

/**
 * Тип изменения в строке при сравнении старого и нового кода.
 */
export type DiffChangeType = 'added' | 'removed' | 'unchanged';

/**
 * Описание одного изменения между старым и новым текстом.
 * Каждая строка старого/нового текста получает свой DiffChange.
 */
export interface DiffChange {
  /** Тип изменения */
  type: DiffChangeType;
  /** Текст строки */
  text: string;
  /** Номер строки в оригинальном документе (0-indexed), -1 для добавленных строк */
  oldLineNumber: number;
  /** Номер строки в новом тексте (0-indexed), -1 для удалённых строк */
  newLineNumber: number;
}

/**
 * Результат сравнения двух текстов: массив изменений + метаданные.
 */
export interface DiffResult {
  /** Построчные изменения */
  changes: DiffChange[];
  /** Совпадают ли тексты полностью */
  identical: boolean;
  /** Количество добавленных строк */
  addedCount: number;
  /** Количество удалённых строк */
  removedCount: number;
}

/**
 * Вычислить diff между старым и новым текстом.
 * Использует LCS-подобный алгоритм (алгоритм Ханта — Шиманского).
 * 
 * @param oldText - исходный текст (выделенный код)
 * @param newText - новый текст (ответ LLM)
 * @returns DiffResult с построчными изменениями
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Если оба текста пусты — diff пустой
  if (oldLines.length === 0 && newLines.length === 0) {
    return {
      changes: [],
      identical: true,
      addedCount: 0,
      removedCount: 0,
    };
  }

  // Если старый текст пуст — все строки newLines добавлены
  if (oldLines.length === 0 || (oldLines.length === 1 && oldLines[0] === '')) {
    const changes: DiffChange[] = newLines.map((line, i) => ({
      type: 'added',
      text: line,
      oldLineNumber: -1,
      newLineNumber: i,
    }));
    return {
      changes,
      identical: false,
      addedCount: newLines.length,
      removedCount: 0,
    };
  }

  // Если новый текст пуст — все строки oldLines удалены
  if (newLines.length === 0 || (newLines.length === 1 && newLines[0] === '')) {
    const changes: DiffChange[] = oldLines.map((line, i) => ({
      type: 'removed',
      text: line,
      oldLineNumber: i,
      newLineNumber: -1,
    }));
    return {
      changes,
      identical: false,
      addedCount: 0,
      removedCount: oldLines.length,
    };
  }

  // Строим LCS матрицу (алгоритм Вагнера — Фишера для LCS)
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Восстанавливаем diff из LCS матрицы (идём с конца)
  const changes: DiffChange[] = [];
  let i = m;
  let j = n;

  // Временные массивы для обратного порядка
  const tempChanges: DiffChange[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Строка не изменилась
      tempChanges.push({
        type: 'unchanged',
        text: oldLines[i - 1],
        oldLineNumber: i - 1,
        newLineNumber: j - 1,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      // Строка добавлена в новом тексте
      tempChanges.push({
        type: 'added',
        text: newLines[j - 1],
        oldLineNumber: -1,
        newLineNumber: j - 1,
      });
      j--;
    } else if (i > 0) {
      // Строка удалена из старого текста
      tempChanges.push({
        type: 'removed',
        text: oldLines[i - 1],
        oldLineNumber: i - 1,
        newLineNumber: -1,
      });
      i--;
    }
  }

  // Разворачиваем массив (шли с конца)
  changes.push(...tempChanges.reverse());

  // Подсчитываем статистику
  let addedCount = 0;
  let removedCount = 0;
  let identical = true;

  for (const change of changes) {
    if (change.type === 'added') {
      addedCount++;
      identical = false;
    } else if (change.type === 'removed') {
      removedCount++;
      identical = false;
    }
  }

  return { changes, identical, addedCount, removedCount };
}

// ===== Декорации для визуализации diff =====

/** Типы декораций для подсветки изменений */
enum DecorationKey {
  Added = 'llmAssistant.diff.added',
  Removed = 'llmAssistant.diff.removed',
  MarginAdded = 'llmAssistant.diff.marginAdded',
  MarginRemoved = 'llmAssistant.diff.marginRemoved',
}

/** Карта активных декораций по редакторам */
const activeDecorations = new Map<string, {
  addedDecoration: vscode.TextEditorDecorationType;
  removedDecoration: vscode.TextEditorDecorationType;
  addedRanges: vscode.Range[];
  removedRanges: vscode.Range[];
}>();

/**
 * Создать типы декораций для подсветки diff.
 * Вызывается один раз при первом использовании.
 */
function createDecorationTypes(): {
  added: vscode.TextEditorDecorationType;
  removed: vscode.TextEditorDecorationType;
} {
  return {
    added: vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(0, 200, 83, 0.15)',
      isWholeLine: true,
      gutterIconPath: undefined,
      overviewRulerColor: 'rgba(0, 200, 83, 0.5)',
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      before: {
        contentText: '+ ',
        color: 'rgba(0, 200, 83, 0.8)',
        fontWeight: 'bold',
      },
    }),
    removed: vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 83, 83, 0.15)',
      isWholeLine: true,
      overviewRulerColor: 'rgba(255, 83, 83, 0.5)',
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      before: {
        contentText: '- ',
        color: 'rgba(255, 83, 83, 0.8)',
        fontWeight: 'bold',
      },
    }),
  };
}

/**
 * Применить декорации diff к указанному редактору.
 * Подсвечивает зелёным добавленные строки и красным — удалённые.
 * 
 * @param editor - активный текстовый редактор
 * @param diffResult - результат сравнения текстов
 * @param selectionStartLine - номер строки, с которой начинается выделение (0-indexed)
 */
export function applyDiffDecorations(
  editor: vscode.TextEditor,
  diffResult: DiffResult,
  selectionStartLine: number
): void {
  // Очищаем предыдущие декорации в этом редакторе
  clearDiffDecorations(editor);

  // Создаём типы декораций
  const { added, removed } = createDecorationTypes();

  const addedRanges: vscode.Range[] = [];
  const removedRanges: vscode.Range[] = [];

  let currentLineOffset = 0;

  for (const change of diffResult.changes) {
    if (change.type === 'added') {
      // Для добавленных строк — подсвечиваем позицию в редакторе
      const lineNumber = selectionStartLine + currentLineOffset;
      if (lineNumber < editor.document.lineCount) {
        const range = new vscode.Range(lineNumber, 0, lineNumber, editor.document.lineAt(lineNumber).text.length);
        addedRanges.push(range);
      }
      currentLineOffset++;
    } else if (change.type === 'removed') {
      // Для удалённых строк — подсвечиваем их текущую позицию
      const lineNumber = selectionStartLine + currentLineOffset;
      if (lineNumber < editor.document.lineCount) {
        const range = new vscode.Range(lineNumber, 0, lineNumber, editor.document.lineAt(lineNumber).text.length);
        removedRanges.push(range);
      }
      currentLineOffset++;
    } else {
      // Неизменённые строки — просто проходим мимо
      currentLineOffset++;
    }
  }

  // Применяем декорации
  editor.setDecorations(added, addedRanges);
  editor.setDecorations(removed, removedRanges);

  // Сохраняем в карте активных декораций
  const docUri = editor.document.uri.toString();
  activeDecorations.set(docUri, {
    addedDecoration: added,
    removedDecoration: removed,
    addedRanges,
    removedRanges,
  });
}

/**
 * Очистить все декорации diff в указанном редакторе.
 * 
 * @param editor - текстовый редактор
 */
export function clearDiffDecorations(editor: vscode.TextEditor): void {
  const docUri = editor.document.uri.toString();
  const existing = activeDecorations.get(docUri);

  if (existing) {
    editor.setDecorations(existing.addedDecoration, []);
    editor.setDecorations(existing.removedDecoration, []);
    existing.addedDecoration.dispose();
    existing.removedDecoration.dispose();
    activeDecorations.delete(docUri);
  }
}

/**
 * Принять изменения: заменить выделенный текст на новый.
 * 
 * @param editor - активный текстовый редактор
 * @param newText - новый текст от LLM
 * @param selectionRange - диапазон выделения в документе
 * @returns true, если изменения успешно применены
 */
export function acceptChanges(
  editor: vscode.TextEditor,
  newText: string,
  selectionRange: vscode.Range
): Thenable<boolean> {
  return editor.edit((editBuilder) => {
    editBuilder.replace(selectionRange, newText);
  });
}

/**
 * Отклонить изменения: просто очистить декорации.
 * 
 * @param editor - текстовый редактор
 */
export function rejectChanges(editor: vscode.TextEditor): void {
  clearDiffDecorations(editor);
}