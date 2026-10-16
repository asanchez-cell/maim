/**
 * Опрос отслеживаемых проектов Asana через Events API — замена постоянного
 * вебхук-сервера, запускается периодически из GitHub Actions
 * (.github/workflows/poll.yml).
 *
 * Между запусками sync-токен на проект хранится в state/sync-tokens.json и
 * коммитится обратно в репозиторий тем же workflow.
 */
import fs from "node:fs";
import path from "node:path";
import { asana } from "../asana/client";
import { processTask } from "../engine/processTask";
import { logger } from "../logger";
import { trackedProjects } from "../projectCodes";

const STATE_FILE = path.join(process.cwd(), "state", "sync-tokens.json");

type State = Record<string, string>;

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

function saveState(state: State): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function pollProject(projectGid: string, code: string, state: State): Promise<void> {
  const priorToken = state[projectGid];
  const result = await asana.getEvents(projectGid, priorToken);

  if (result.needsResync) {
    // Первый запуск (или токен устарел) — Asana не отдаёт события "задним числом",
    // поэтому просто фиксируем новый токен без обработки существующих задач.
    logger.info("Первичная синхронизация проекта — без обработки истории", { code, projectGid });
    state[projectGid] = result.sync;
    return;
  }

  // "added" — задача только что попала в проект. "changed" — только по
  // полям, которые агент сам проверяет (name/notes/assignee/due_on): это
  // позволяет довести до конца недоделанное (например, добавили описание на
  // испанском, но забыли перевод) без "перетряхивания" задач при любой
  // правке. processTask идемпотентен — уже решённые проверки просто
  // пропускаются.
  const TRACKED_FIELDS = new Set(["name", "notes", "assignee", "due_on", "due_at"]);
  const taskGids = new Set<string>();
  for (const event of result.events) {
    if (event.resource?.resource_type !== "task") continue;
    if (event.action === "added") {
      taskGids.add(event.resource.gid);
    } else if (event.action === "changed" && event.change?.field && TRACKED_FIELDS.has(event.change.field)) {
      taskGids.add(event.resource.gid);
    }
  }

  for (const gid of taskGids) {
    try {
      await processTask(gid);
    } catch (err) {
      logger.error("Ошибка обработки задачи при поллинге", { gid, code, err: String(err) });
    }
  }

  state[projectGid] = result.sync;
  logger.info("Проект опрошен", { code, events: result.events.length, tasksProcessed: taskGids.size });
}

async function main(): Promise<void> {
  const projects = trackedProjects();
  if (projects.length === 0) {
    logger.warn("Нет включённых (enabled=true) проектов в config/projectCodes.json — опрашивать нечего");
    return;
  }

  const state = loadState();
  let hadErrors = false;

  for (const project of projects) {
    try {
      await pollProject(project.asanaProjectGid, project.code, state);
    } catch (err) {
      hadErrors = true;
      logger.error("Ошибка опроса проекта", { code: project.code, err: String(err) });
    }
  }

  // Сохраняем прогресс по тем проектам, что опросились успешно, даже если
  // другие упали — но сам запуск workflow должен стать "красным", чтобы
  // ошибка не осталась незамеченной.
  saveState(state);
  if (hadErrors) {
    throw new Error("Один или несколько проектов не удалось опросить — подробности в логах выше");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error("Поллинг завершился с ошибкой", { err: String(err) });
    process.exit(1);
  });
