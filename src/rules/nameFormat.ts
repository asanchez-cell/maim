import { evaluateAndFixTaskName, type NameEvaluation } from "../claude/client";

/**
 * Задача попадает сюда уже будучи членом проекта Gestión Operativa — агент
 * отслеживает только такие проекты (Actas de reuniones и прочие категории
 * вне MVP и сюда не доходят). Поэтому единственный вопрос — соответствует
 * ли название единому стандарту "[KOD] — [Verbo infinitivo] + complemento".
 */
export async function checkTaskName(name: string, code: string): Promise<NameEvaluation> {
  return evaluateAndFixTaskName(name.trim(), code);
}
