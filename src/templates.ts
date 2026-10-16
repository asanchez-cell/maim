/**
 * Шаблоны комментариев и Notes. Комментарии агента — компактные и только на
 * испанском (единый язык коммуникации с командой). Notes (описание задачи)
 * остаются двуязычными ES+RU — см. src/rules/notes.ts.
 */

export const EMPTY_NOTES_TEMPLATE =
  "[Pendiente de completar — añade el contexto de la tarea aquí]\n\n---\n\n" +
  "[Заполнить описание — добавь контекст задачи]";

export function nameErrorComment(creatorName: string, currentName: string, reason: string): string {
  return (
    `👋 ${creatorName}, no me queda claro qué hay que hacer en "${currentName}" (${reason}). ` +
    `¿Puedes aclararlo o renombrarla? Formato: [Verbo infinitivo] + complemento.`
  );
}

export function nameFixedComment(oldName: string, newName: string): string {
  return `✏️ Renombrada para seguir el estándar: "${oldName}" → "${newName}". Corrígelo si no es correcto.`;
}

export function notesTemplateAddedComment(): string {
  return `📝 Añadida plantilla de descripción (ES/RU) — complétala, por favor.`;
}

export function possibleDuplicateComment(params: {
  similarTaskName: string;
  similarTaskLink: string;
  assignee: string;
  dueDate: string;
  status: string;
}): string {
  const { similarTaskName, similarTaskLink, assignee, dueDate, status } = params;
  return (
    `⚠︎ Posible duplicado: "${similarTaskName}" → ${similarTaskLink} ` +
    `(Responsable: ${assignee} | Vencimiento: ${dueDate} | Estado: ${status}). ` +
    `¿Es otra tarea o se puede cerrar esta y seguir en la vinculada?`
  );
}

export function missingFieldsComment(
  creatorName: string,
  missingAssignee: boolean,
  missingDueDate: boolean,
): string {
  const missing = [missingAssignee && "el responsable", missingDueDate && "la fecha límite"]
    .filter(Boolean)
    .join(" y ");
  return `👤 ${creatorName}, falta ${missing}. ¿Puedes indicarlo?`;
}
