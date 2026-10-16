/**
 * Шаблоны комментариев и Notes. Комментарии агента — только на испанском
 * (единый язык коммуникации с командой). Notes (описание задачи) остаются
 * двуязычными ES+RU — см. src/rules/notes.ts.
 */

export const EMPTY_NOTES_TEMPLATE =
  "[Pendiente de completar — añade el contexto de la tarea aquí]\n\n---\n\n" +
  "[Заполнить описание — добавь контекст задачи]";

export function nameErrorComment(creatorName: string, currentName: string, code: string, reason: string): string {
  return (
    `👋 ${creatorName}, el nombre de la tarea no deja claro qué hay que hacer, así que no me atrevo a ` +
    `reformularlo yo mismo: ${reason}\n\n` +
    `Formato correcto: [CODIGO] — [Verbo infinitivo] + complemento\n` +
    `Ejemplo: ${code} — Obtener presupuesto de movimiento de tierras\n\n` +
    `Nombre actual: "${currentName}"\n\n` +
    `¿Puedes aclararlo o corregirlo? Gracias 🙏`
  );
}

export function nameFixedComment(oldName: string, newName: string): string {
  return (
    `✏️ El nombre de la tarea no seguía el estándar de Prestige Expo (debe estar en español y con el ` +
    `formato "[CODIGO] — [Verbo infinitivo] + complemento"), así que lo he corregido manteniendo el ` +
    `mismo sentido.\n\n` +
    `Antes: "${oldName}"\n` +
    `Ahora: "${newName}"\n\n` +
    `Si no refleja correctamente lo que se necesita, corrígelo libremente.`
  );
}

export function notesTemplateAddedComment(): string {
  return `📝 Se ha añadido una plantilla de descripción bilingüe (ES/RU).\nPor favor, completa el contexto de la tarea.`;
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
    `⚠︎ Posible tarea duplicada\n\n` +
    `Tarea similar encontrada:\n"${similarTaskName}" → ${similarTaskLink}\n` +
    `Responsable: ${assignee} | Vencimiento: ${dueDate} | Estado: ${status}\n\n` +
    `¿Es una tarea diferente o un duplicado?\n` +
    `Si es duplicado → cierra esta tarea y continúa en la vinculada.`
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
  const ask = [missingAssignee && "quién se encarga", missingDueDate && "para cuándo"]
    .filter(Boolean)
    .join(" y ");

  return `👤 ${creatorName}, a esta tarea le falta ${missing}.\n\n¿Puedes indicar ${ask}? Gracias 🙏`;
}
