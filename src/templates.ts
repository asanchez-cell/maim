/**
 * Шаблоны комментариев и Notes из раздела 6 инструкции. Все двуязычные тексты
 * идут в формате "[ES]\n---\n[RU]" — как и структура Notes из раздела 3.
 */

export const EMPTY_NOTES_TEMPLATE =
  "[Pendiente de completar — añade el contexto de la tarea aquí]\n\n---\n\n" +
  "[Заполнить описание — добавь контекст задачи]";

export function nameErrorComment(creatorName: string, currentName: string, code: string, reason: string): string {
  const es =
    `👋 ${creatorName}, el nombre de la tarea no deja claro qué hay que hacer, así que no me atrevo a ` +
    `reformularlo yo mismo: ${reason}\n\n` +
    `Formato correcto: [CODIGO] — [Verbo infinitivo] + complemento\n` +
    `Ejemplo: ${code} — Obtener presupuesto de movimiento de tierras\n\n` +
    `Nombre actual: "${currentName}"\n\n` +
    `¿Puedes aclararlo o corregirlo? Gracias 🙏`;

  const ru =
    `👋 ${creatorName}, по названию задачи не могу понять, что именно нужно сделать, поэтому не ` +
    `переформулирую сам: ${reason}\n\n` +
    `Правильный формат: [KOD] — [Глагол в инфинитиве] + дополнение\n` +
    `Пример: ${code} — Получить смету на земляные работы\n\n` +
    `Текущее: "${currentName}"\n\n` +
    `Можешь уточнить или поправить?`;

  return `${es}\n\n---\n\n${ru}`;
}

export function nameFixedComment(oldName: string, newName: string): string {
  const es =
    `✏️ El nombre de la tarea no seguía el estándar de Prestige Expo, así que lo he corregido ` +
    `manteniendo el mismo sentido.\n\n` +
    `Antes: "${oldName}"\n` +
    `Ahora: "${newName}"\n\n` +
    `Si no refleja correctamente lo que se necesita, corrígelo libremente.`;

  const ru =
    `✏️ Название задачи не соответствовало стандарту Prestige Expo, поэтому я поправил его, сохранив смысл.\n\n` +
    `Было: "${oldName}"\n` +
    `Стало: "${newName}"\n\n` +
    `Если это не то, что имелось в виду — поправь, как считаешь нужным.`;

  return `${es}\n\n---\n\n${ru}`;
}

export function notesTemplateAddedComment(): string {
  const es = `📝 Se ha añadido una plantilla de descripción bilingüe.\nPor favor, completa el contexto de la tarea.`;
  const ru = `📝 Добавлен шаблон описания на двух языках.\nПожалуйста, заполни контекст задачи.`;
  return `${es}\n\n---\n\n${ru}`;
}

export function possibleDuplicateComment(params: {
  similarTaskName: string;
  similarTaskLink: string;
  assignee: string;
  dueDate: string;
  status: string;
}): string {
  const { similarTaskName, similarTaskLink, assignee, dueDate, status } = params;

  const es =
    `⚠︎ Posible tarea duplicada\n\n` +
    `Tarea similar encontrada:\n"${similarTaskName}" → ${similarTaskLink}\n` +
    `Responsable: ${assignee} | Vencimiento: ${dueDate} | Estado: ${status}\n\n` +
    `¿Es una tarea diferente o un duplicado?\n` +
    `Si es duplicado → cierra esta tarea y continúa en la vinculada.`;

  const ru =
    `⚠︎ Возможный дубль\n\n` +
    `Найдена похожая задача:\n"${similarTaskName}" → ${similarTaskLink}\n` +
    `Ответственный: ${assignee} | Срок: ${dueDate} | Статус: ${status}\n\n` +
    `Это другая задача или дубль?\n` +
    `Если дубль → закрой эту и продолжай в найденной.`;

  return `${es}\n\n---\n\n${ru}`;
}

export function missingFieldsComment(
  creatorName: string,
  missingAssignee: boolean,
  missingDueDate: boolean,
): string {
  const esMissing = [missingAssignee && "el responsable", missingDueDate && "la fecha límite"]
    .filter(Boolean)
    .join(" y ");
  const esAsk = [missingAssignee && "quién se encarga", missingDueDate && "para cuándo"]
    .filter(Boolean)
    .join(" y ");

  const ruMissing = [missingAssignee && "ответственного", missingDueDate && "срока выполнения"]
    .filter(Boolean)
    .join(" и ");
  const ruAsk = [missingAssignee && "кто отвечает", missingDueDate && "к какому сроку"]
    .filter(Boolean)
    .join(" и ");

  const es =
    `👤 ${creatorName}, a esta tarea le falta ${esMissing}.\n\n` + `¿Puedes indicar ${esAsk}? Gracias 🙏`;

  const ru = `👤 ${creatorName}, в задаче не хватает: ${ruMissing}.\n\n` + `Можешь указать, ${ruAsk}?`;

  return `${es}\n\n---\n\n${ru}`;
}
