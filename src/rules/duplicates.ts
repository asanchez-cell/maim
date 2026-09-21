import { judgeDuplicatePair } from "../claude/client";
import type { AsanaTask } from "../asana/types";

const STOP_WORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "en",
  "para",
  "por",
  "con",
  "del",
  "al",
  "a",
  "y",
  "o",
  "un",
  "una",
  "unos",
  "unas",
  "que",
  "se",
  "su",
  "sus",
  "lo",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Убирает префикс "[KOD] — " из названия перед токенизацией.
function stripCodePrefix(name: string): string {
  return name.replace(/^\S{2,6}\s*[—-]\s*/, "");
}

function tokenize(name: string): Set<string> {
  const withoutPrefix = stripCodePrefix(name);
  const words = stripAccents(withoutPrefix.toLowerCase())
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/** Доля пересечения слов относительно меньшего из двух названий. */
export function nameOverlapRatio(nameA: string, nameB: string): number {
  const a = tokenize(nameA);
  const b = tokenize(nameB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  return intersection / Math.min(a.size, b.size);
}

/** Значимые токены (потенциальные имена объектов/подрядчиков): слова с заглавной буквы, числа. */
function significantTokens(name: string): Set<string> {
  const withoutPrefix = stripCodePrefix(name);
  const tokens = withoutPrefix.match(/\b([A-ZÀ-Ú][\wÀ-ÿ]{2,}|\d{3,})\b/g) ?? [];
  return new Set(tokens.map((t) => t.toLowerCase()));
}

function sharesSignificantEntity(nameA: string, nameB: string): boolean {
  const a = significantTokens(nameA);
  const b = significantTokens(nameB);
  for (const t of a) {
    if (b.has(t)) return true;
  }
  return false;
}

export interface DuplicateHeuristicMatch {
  task: AsanaTask;
  heuristicReason: string;
}

/**
 * Раздел 4: критерии похожести (достаточно одного из них):
 * - совпадение 70%+ слов в названии
 * - одинаковый исполнитель + похожее название (50%+)
 * - одинаковый объект/подрядчик в одном контексте (эвристика по значимым токенам)
 */
export function findHeuristicCandidates(
  target: AsanaTask,
  candidates: AsanaTask[],
): DuplicateHeuristicMatch[] {
  const matches: DuplicateHeuristicMatch[] = [];

  for (const other of candidates) {
    if (other.gid === target.gid || other.completed) continue;

    const overlap = nameOverlapRatio(target.name, other.name);
    const sameAssignee =
      Boolean(target.assignee) && Boolean(other.assignee) && target.assignee?.gid === other.assignee?.gid;

    if (overlap >= 0.7) {
      matches.push({ task: other, heuristicReason: `совпадение слов в названии ${Math.round(overlap * 100)}%` });
      continue;
    }

    if (sameAssignee && overlap >= 0.5) {
      matches.push({
        task: other,
        heuristicReason: `одинаковый исполнитель и совпадение названия ${Math.round(overlap * 100)}%`,
      });
      continue;
    }

    if (sharesSignificantEntity(target.name, other.name)) {
      matches.push({ task: other, heuristicReason: "общий объект/подрядчик в названии" });
    }
  }

  return matches;
}

export interface ConfirmedDuplicate {
  task: AsanaTask;
  reason: string;
}

/**
 * Финальное подтверждение кандидатов через Claude, чтобы отсеять ложные
 * срабатывания (например, две разные заявки для разных объектов).
 */
export async function confirmDuplicates(
  target: AsanaTask,
  candidates: DuplicateHeuristicMatch[],
): Promise<ConfirmedDuplicate[]> {
  const confirmed: ConfirmedDuplicate[] = [];

  for (const candidate of candidates) {
    const judged = await judgeDuplicatePair(
      { name: target.name, notes: target.notes },
      { name: candidate.task.name, notes: candidate.task.notes },
    );
    if (judged.likelyDuplicate) {
      confirmed.push({ task: candidate.task, reason: judged.reason });
    }
  }

  return confirmed;
}

export async function findConfirmedDuplicates(
  target: AsanaTask,
  allTasksInProject: AsanaTask[],
): Promise<ConfirmedDuplicate[]> {
  const heuristic = findHeuristicCandidates(target, allTasksInProject);
  if (heuristic.length === 0) return [];
  return confirmDuplicates(target, heuristic);
}
