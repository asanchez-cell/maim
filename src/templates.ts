/**
 * Фрагменты одного сводного комментария агента (см. src/engine/processTask.ts)
 * — только на испанском, компактные, собираются в одно сообщение с
 * @-упоминанием автора задачи. Notes (описание задачи) — двуязычные ES+RU.
 */

// Только испанский плейсхолдер: перевод на русский — задача агента, не
// человека. Как только появится реальный текст на испанском, агент сам
// молча допишет русский (см. src/rules/notes.ts) — никого об этом не просят.
export const EMPTY_NOTES_TEMPLATE = "[Pendiente de completar — añade el contexto de la tarea aquí]";

export function nameAskFragment(currentName: string, reason: string): string {
  return (
    `no tengo claro qué hacer con "${currentName}" (${reason}) — ¿puedes aclararlo o renombrarla? ` +
    `Formato: [Verbo infinitivo] + complemento.`
  );
}

export function nameFixedFragment(oldName: string, newName: string): string {
  return `he renombrado la tarea para seguir el estándar: "${oldName}" → "${newName}" (corrígelo si no es correcto).`;
}

export function notesNeededFragment(): string {
  return `añade una breve descripción del contexto de la tarea.`;
}

export function missingFieldsFragment(missingAssignee: boolean, missingDueDate: boolean): string {
  const missing = [missingAssignee && "el responsable", missingDueDate && "la fecha límite"]
    .filter(Boolean)
    .join(" y ");
  return `falta ${missing}.`;
}

export function duplicateFragment(params: { similarTaskName: string; similarTaskLink: string }): string {
  return `posible duplicado de "${params.similarTaskName}" → ${params.similarTaskLink}.`;
}
