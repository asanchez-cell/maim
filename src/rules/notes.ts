import { detectLanguages, translateText } from "../claude/client";
import { EMPTY_NOTES_TEMPLATE } from "../templates";

export type NotesAction = "none" | "added_template" | "added_translation";

export interface NotesCheckResult {
  action: NotesAction;
  updatedNotes?: string;
}

/**
 * Раздел 3: структура Notes и действия агента в зависимости от ситуации.
 * Агент никогда не переписывает существующий текст — только добавляет
 * недостающий язык.
 */
export async function reconcileNotes(currentNotes: string): Promise<NotesCheckResult> {
  const trimmed = (currentNotes ?? "").trim();

  if (!trimmed) {
    return { action: "added_template", updatedNotes: EMPTY_NOTES_TEMPLATE };
  }

  const { hasEs, hasRu } = await detectLanguages(trimmed);

  if (hasEs && hasRu) {
    return { action: "none" };
  }

  if (hasEs && !hasRu) {
    const ru = await translateText(trimmed, "ru");
    return { action: "added_translation", updatedNotes: `${trimmed}\n\n---\n\n${ru}` };
  }

  if (hasRu && !hasEs) {
    const es = await translateText(trimmed, "es");
    return { action: "added_translation", updatedNotes: `${es}\n\n---\n\n${trimmed}` };
  }

  // Текст есть, но ни один из языков не распознан содержательно — не трогаем,
  // чтобы не испортить то, что уже написал человек.
  return { action: "none" };
}
