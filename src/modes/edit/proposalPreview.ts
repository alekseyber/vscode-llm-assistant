/**
 * Построение пары «до / после» для показа предлагаемой правки в родном diff-редакторе VS Code.
 *
 * Зачем: декорации в исходном файле показывают только *места*, куда придёт правка,
 * но не сам новый код — при частичном выделении подсвеченные строки визуально совпадают
 * с уже существующим текстом, и пользователь не понимает, что ему предлагают.
 * Здесь восстанавливается полный текст файла до и после замены, и VS Code сам
 * рисует красно-зелёный diff.
 */

export interface ProposalPreview {
  /** Полный текст файла до правки */
  before: string;
  /** Полный текст файла после замены выделения на новый код */
  after: string;
}

/**
 * Заменить диапазон [startOffset, endOffset) в тексте на newText.
 *
 * @param fullText - полный текст документа
 * @param startOffset - смещение начала выделения
 * @param endOffset - смещение конца выделения
 * @param newText - текст, предложенный моделью
 */
export function buildProposalPreview(
  fullText: string,
  startOffset: number,
  endOffset: number,
  newText: string,
): ProposalPreview {
  const start = Math.max(0, Math.min(startOffset, fullText.length));
  const end = Math.max(start, Math.min(endOffset, fullText.length));
  return {
    before: fullText,
    after: fullText.slice(0, start) + newText + fullText.slice(end),
  };
}
