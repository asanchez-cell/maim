import { asana } from "../asana/client";
import { config } from "../config";
import { logger } from "../logger";
import { operationalProjects } from "../projectCodes";
import { judgeDuplicatePair } from "../claude/client";
import { nameOverlapRatio } from "../rules/duplicates";
import type { AsanaTask } from "../asana/types";
import type { ProjectCodeEntry } from "../projectCodes";

const REPORT_TASK_NAME = "Упоминание: найдены возможные дубли";

interface ReportedPair {
  project: ProjectCodeEntry;
  taskA: AsanaTask;
  taskB: AsanaTask;
  reason: string;
}

function sameAssignee(a: AsanaTask, b: AsanaTask): boolean {
  return Boolean(a.assignee) && Boolean(b.assignee) && a.assignee?.gid === b.assignee?.gid;
}

async function scanProjectForPairs(project: ProjectCodeEntry): Promise<ReportedPair[]> {
  const tasks = await asana.getProjectTasks(project.asanaProjectGid);
  const pairs: ReportedPair[] = [];

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const overlap = nameOverlapRatio(a.name, b.name);

      let heuristicReason: string | null = null;
      if (overlap >= 0.7) {
        heuristicReason = `совпадение слов в названии ${Math.round(overlap * 100)}%`;
      } else if (sameAssignee(a, b) && overlap >= 0.5) {
        heuristicReason = `одинаковый исполнитель и совпадение названия ${Math.round(overlap * 100)}%`;
      }
      if (!heuristicReason) continue;

      const judged = await judgeDuplicatePair(
        { name: a.name, notes: a.notes },
        { name: b.name, notes: b.notes },
      );
      if (judged.likelyDuplicate) {
        pairs.push({ project, taskA: a, taskB: b, reason: judged.reason });
      }
    }
  }

  return pairs;
}

function buildReportNotes(pairs: ReportedPair[]): string {
  if (pairs.length === 0) {
    return (
      `[${new Date().toISOString().slice(0, 10)}] Дублей не найдено.\n\n---\n\n` +
      `[${new Date().toISOString().slice(0, 10)}] Дублей не обнаружено.`
    );
  }

  const byProject = new Map<string, ReportedPair[]>();
  for (const p of pairs) {
    const list = byProject.get(p.project.code) ?? [];
    list.push(p);
    byProject.set(p.project.code, list);
  }

  const lines: string[] = [`Автоматическая проверка от ${new Date().toISOString().slice(0, 10)}`, ""];
  for (const [code, projectPairs] of byProject) {
    lines.push(`## ${code} — ${projectPairs[0].project.shortName}`);
    for (const pair of projectPairs) {
      lines.push(
        `- "${pair.taskA.name}" (${pair.taskA.permalink_url}) ↔ "${pair.taskB.name}" (${pair.taskB.permalink_url}) — ${pair.reason}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Раздел 4, триггер 2: еженедельная (воскресенье) проверка всех проектов
 * Gestión Operativa на дубли. Агент не удаляет дубли — только помечает и
 * спрашивает человека через сводный отчёт.
 */
export async function runWeeklyDuplicateScan(): Promise<void> {
  if (!config.reportProjectGid) {
    logger.warn("REPORT_PROJECT_GID не задан — пропуск еженедельной проверки дублей");
    return;
  }

  logger.info("Запуск еженедельной проверки дублей");
  const allPairs: ReportedPair[] = [];

  for (const project of operationalProjects()) {
    try {
      const pairs = await scanProjectForPairs(project);
      allPairs.push(...pairs);
    } catch (err) {
      logger.error("Ошибка сканирования проекта на дубли", { code: project.code, err: String(err) });
    }
  }

  const notes = buildReportNotes(allPairs);
  const existing = await asana.findTaskByName(config.reportProjectGid, REPORT_TASK_NAME);

  if (existing) {
    await asana.updateNotes(existing.gid, notes);
  } else {
    await asana.createTask(config.reportProjectGid, REPORT_TASK_NAME, notes);
  }

  logger.info("Еженедельная проверка дублей завершена", { pairsFound: allPairs.length });
}
