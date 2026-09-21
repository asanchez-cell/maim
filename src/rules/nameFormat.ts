import { classifyAmbiguousTaskName, verifyVerbInfinitiveComplement } from "../claude/client";
import { allKnownCodes, findByGid } from "../projectCodes";
import type { AsanaTask } from "../asana/types";

export type TaskCategory = "acta" | "acuerdo" | "gestion_operativa" | "unknown";

export interface NameCheckResult {
  category: TaskCategory;
  valid: boolean;
  reason: string;
}

const ACTA_TIPOS = [
  "Weekly Management",
  "Design Coordination",
  "Construction",
  "Technical",
  "Commercial",
  "Internal",
  "Other",
];

// "YYMMDD | YYMM_CODIGO | EMPRESA | Tipo de reunion" (раздел 1)
const ACTA_REGEX = new RegExp(
  `^\\d{6}\\s*\\|\\s*\\d{4}_[A-ZÀ-Úa-zà-ÿ0-9]+\\s*\\|\\s*[A-ZÀ-Úa-zà-ÿ0-9\\-]+\\s*\\|\\s*(${ACTA_TIPOS.join("|")})$`,
);

// Разделитель между кодом/категорией и остальным текстом: "—" (em dash) или " - "
const DASH_SPLIT = /\s+[—-]\s+/;

function splitOnDash(name: string): [string, string] | null {
  const match = name.match(DASH_SPLIT);
  if (!match || match.index === undefined) return null;
  const left = name.slice(0, match.index).trim();
  const right = name.slice(match.index + match[0].length).trim();
  if (!left || !right) return null;
  return [left, right];
}

export function isActaFormat(name: string): boolean {
  return ACTA_REGEX.test(name.trim());
}

/**
 * Определяет ожидаемую категорию и код проекта для задачи, затем проверяет
 * соответствие формату из раздела 1 инструкции.
 */
export async function checkTaskName(task: AsanaTask): Promise<NameCheckResult> {
  const name = task.name.trim();
  const knownCodes = allKnownCodes();

  // Задача-соглашение: подзадача протокола встречи (родитель в формате Acta)
  if (task.parent && isActaFormat(task.parent.name)) {
    const parts = splitOnDash(name);
    if (!parts) {
      return {
        category: "acuerdo",
        valid: false,
        reason: 'Нет структуры "[Categoria] — [описание действия]"',
      };
    }
    return { category: "acuerdo", valid: true, reason: "OK" };
  }

  // Протокол встречи (Acta de Reunión)
  if (isActaFormat(name)) {
    return { category: "acta", valid: true, reason: "OK" };
  }

  // Задача Gestión Operativa: "[KOD] — [Verbo infinitivo] + complemento"
  const project = task.projects
    .map((p) => findByGid(p.gid))
    .find((p): p is NonNullable<typeof p> => Boolean(p));

  const parts = splitOnDash(name);
  if (parts && project) {
    const [code, rest] = parts;
    if (code.toUpperCase() !== project.code) {
      return {
        category: "gestion_operativa",
        valid: false,
        reason: `Код "${code}" не соответствует проекту — ожидается "${project.code}"`,
      };
    }
    const verbCheck = await verifyVerbInfinitiveComplement(rest);
    return { category: "gestion_operativa", valid: verbCheck.ok, reason: verbCheck.reason };
  }

  // Не удалось разобрать структурно — финальная проверка через Claude
  const judged = await classifyAmbiguousTaskName(name, knownCodes);
  return { category: "unknown", valid: judged.ok, reason: judged.reason };
}
