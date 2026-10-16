import { evaluateAndFixTaskName, type NameEvaluation } from "../claude/client";

/**
 * Задача попадает сюда уже будучи членом проекта Gestión Operativa — агент
 * отслеживает только такие проекты. Поэтому единственный вопрос —
 * соответствует ли название единому стандарту "[Verbo infinitivo] +
 * complemento" (код объекта в названии не нужен — он виден из проекта).
 */
export async function checkTaskName(name: string): Promise<NameEvaluation> {
  return evaluateAndFixTaskName(name.trim());
}
