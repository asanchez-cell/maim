/**
 * Шаблоны комментариев и Notes из раздела 6 инструкции. Все двуязычные тексты
 * идут в формате "[ES]\n---\n[RU]" — как и структура Notes из раздела 3.
 */

export const EMPTY_NOTES_TEMPLATE =
  "[Pendiente de completar — añade el contexto de la tarea aquí]\n\n---\n\n" +
  "[Заполнить описание — добавь контекст задачи]";

export function nameErrorComment(creatorName: string, currentName: string, code: string): string {
  const es =
    `👋 ${creatorName}, el nombre de la tarea no sigue el estándar de Prestige Expo.\n\n` +
    `Formato correcto: [CODIGO] — [Verbo infinitivo] + complemento\n` +
    `Ejemplo: ${code} — Obtener presupuesto de movimiento de tierras\n\n` +
    `Nombre actual: "${currentName}"\n\n` +
    `Por favor, ¿puedes corregirlo? Gracias 🙏`;

  const ru =
    `👋 ${creatorName}, название задачи не соответствует стандарту Prestige Expo.\n\n` +
    `Правильный формат: [KOD] — [Глагол в инфинитиве] + дополнение\n` +
    `Пример: ${code} — Получить смету на земляные работы\n\n` +
    `Текущее: "${currentName}"\n\n` +
    `Можем исправить?`;

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

export function noAssigneeComment(): string {
  const es = `👤 Esta tarea no tiene responsable asignado.\n¿Quién se encarga de llevarla adelante?`;
  const ru = `👤 Нет исполнителя. Кто отвечает за эту задачу?`;
  return `${es}\n\n---\n\n${ru}`;
}
