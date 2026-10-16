import { resolveMention } from "../claude/client";
import { asana } from "../asana/client";
import { logger } from "../logger";

const MAX_TRACKED_COMMENT_GIDS = 300;
const MAX_CONTEXT_COMMENTS = 6;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

function mentionsUser(htmlText: string | undefined, userGid: string): boolean {
  if (!htmlText) return false;
  return htmlText.includes(`data-asana-gid="${userGid}"`);
}

/**
 * Проверяет задачи проекта, изменённые за последние 24 часа, на новые
 * комментарии с упоминанием бота, и реагирует на каждое: либо отвечает
 * текстом, либо выполняет явно и однозначно запрошенное действие
 * (поправить название/описание, разделить задачу на две) — см.
 * src/claude/client.ts resolveMention. Events API не даёт событий по новым
 * комментариям напрямую, поэтому используется отдельный проход по
 * "modified_since" вместо sync-токена.
 *
 * Идемпотентность — только через answeredCommentGids (упоминание
 * помечается отвеченным исключительно при успешной публикации ответа).
 * Окно сканирования — фиксированные последние 24 часа от "сейчас", не
 * чекпоинт: так неудачная попытка (например, сбой API) не "теряет"
 * упоминание навсегда, если потом никто больше не тронет задачу — оно
 * просто попадёт в скан на следующем опросе, пока его не отработают.
 */
export async function checkMentionsForProject(
  projectGid: string,
  code: string,
  botGid: string,
  answeredSoFar: string[] | undefined,
): Promise<string[]> {
  const answeredCommentGids = new Set(answeredSoFar ?? []);
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const tasks = await asana.getTasksModifiedSince(projectGid, since);
  let answered = 0;

  for (const task of tasks) {
    if (task.completed) continue;

    let stories;
    try {
      stories = await asana.getStories(task.gid);
    } catch (err) {
      logger.error("Не удалось получить комментарии задачи для проверки упоминаний", {
        taskGid: task.gid,
        code,
        err: String(err),
      });
      continue;
    }

    const comments = stories.filter((s) => s.type === "comment" || s.resource_subtype === "comment_added");
    // Несколько ожидающих упоминаний на одной задаче в одном проходе часто
    // оказываются повторением одной и той же просьбы (как было на практике:
    // человек дважды просил разделить задачу, потому что первая попытка
    // упоминания не сработала) — действие (fix/split) выполняется на задаче
    // не больше одного раза за проход, иначе получаются задачи-дубли.
    let taskActedOnThisRun = false;

    for (const story of comments) {
      if (story.created_by?.gid === botGid) continue;
      if (answeredCommentGids.has(story.gid)) continue;
      if (!mentionsUser(story.html_text, botGid)) continue;

      const recentComments = comments
        .filter((s) => s.created_at <= story.created_at && s.gid !== story.gid)
        .slice(-MAX_CONTEXT_COMMENTS)
        .map((s) => s.text);

      try {
        const resolution = await resolveMention({
          taskName: task.name,
          taskNotes: task.notes,
          recentComments,
          question: story.text,
        });

        if ((resolution.kind === "fix" || resolution.kind === "split") && taskActedOnThisRun) {
          resolution.kind = "reply";
          resolution.reply =
            "Ya actué sobre esta tarea respondiendo a una mención anterior en esta misma tanda — revisa los " +
            "comentarios y tareas más recientes.";
        } else if (resolution.kind === "fix") {
          if (resolution.newName) await asana.updateName(task.gid, resolution.newName);
          if (resolution.newNotes) await asana.updateNotes(task.gid, resolution.newNotes);
          logger.info("Задача исправлена по запросу в упоминании", { taskGid: task.gid, code });
          taskActedOnThisRun = true;
        } else if (resolution.kind === "split") {
          if (resolution.keepName) await asana.updateName(task.gid, resolution.keepName);
          if (resolution.keepNotes) await asana.updateNotes(task.gid, resolution.keepNotes);
          for (const newTask of resolution.newTasks ?? []) {
            const created = await asana.createTask(projectGid, newTask.name, newTask.notes ?? "");
            logger.info("Создана задача при разделении по запросу в упоминании", {
              taskGid: task.gid,
              newTaskGid: created.gid,
              code,
            });
          }
          taskActedOnThisRun = true;
        }

        const askerGid = story.created_by?.gid;
        if (askerGid) {
          await asana.addMentionComment(task.gid, askerGid, resolution.reply);
        } else {
          await asana.addComment(task.gid, resolution.reply);
        }

        // Помечаем отвеченным только после успешной публикации — иначе
        // сбой (например, Claude не уложился в лимит токенов) навсегда
        // "съедал" бы упоминание без ответа.
        answeredCommentGids.add(story.gid);
        logger.info("Ответ на упоминание опубликован", {
          taskGid: task.gid,
          code,
          commentGid: story.gid,
          kind: resolution.kind,
        });
        answered++;
      } catch (err) {
        logger.error("Ошибка при обработке упоминания — попробуем снова на следующем опросе", {
          taskGid: task.gid,
          code,
          commentGid: story.gid,
          err: String(err),
        });
      }
    }
  }

  if (answered > 0) {
    logger.info("Проверка упоминаний завершена", { code, tasksChecked: tasks.length, answered });
  }

  return [...answeredCommentGids].slice(-MAX_TRACKED_COMMENT_GIDS);
}
