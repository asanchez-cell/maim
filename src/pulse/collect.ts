import { asana } from "../asana/client";
import { logger } from "../logger";
import { trackedProjects } from "../projectCodes";
import { PULSE_WEEKS, type PulseData, type PulseProject } from "./types";

/**
 * Сырые данные для дашборда: по каждому отслеживаемому проекту — открытые
 * задачи и закрытые за последние PULSE_WEEKS недель. Все метрики считаются
 * уже при рендере, поэтому этот JSON можно сохранить и перерисовать офлайн.
 */
export async function collectPulse(now = new Date()): Promise<PulseData> {
  const since = new Date(now.getTime() - PULSE_WEEKS * 7 * 86_400_000).toISOString();
  const projects: PulseProject[] = [];

  for (const p of trackedProjects()) {
    const base = { code: p.code, shortName: p.shortName, name: p.asanaProjectName, gid: p.asanaProjectGid };
    try {
      const tasks = await asana.getProjectPulseTasks(p.asanaProjectGid, since);
      projects.push({
        ...base,
        tasks: tasks.map((t) => ({
          gid: t.gid,
          name: t.name,
          url: t.permalink_url,
          assignee: t.assignee?.name ?? null,
          dueOn: t.due_on,
          completed: t.completed,
          createdAt: t.created_at ?? null,
          completedAt: t.completed_at ?? null,
        })),
      });
      logger.info("Пульс: проект прочитан", { code: p.code, tasks: tasks.length });
    } catch (err) {
      logger.error("Пульс: не удалось прочитать проект", { code: p.code, err: String(err) });
      projects.push({ ...base, error: String(err), tasks: [] });
    }
  }

  return { generatedAt: now.toISOString(), projects };
}
