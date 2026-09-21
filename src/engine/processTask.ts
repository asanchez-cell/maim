import { asana } from "../asana/client";
import type { AsanaTask } from "../asana/types";
import { logger } from "../logger";
import { findByGid } from "../projectCodes";
import { findConfirmedDuplicates } from "../rules/duplicates";
import { checkTaskName } from "../rules/nameFormat";
import { reconcileNotes } from "../rules/notes";
import {
  nameErrorComment,
  noAssigneeComment,
  notesTemplateAddedComment,
  possibleDuplicateComment,
} from "../templates";

const MARKERS = {
  nameError: "👋",
  notesTemplate: "📝",
  duplicate: "⚠︎",
  noAssignee: "👤",
};

const IGNORED_SUBTYPES = new Set(["milestone", "approval", "section"]);

/**
 * Раздел 5: дерево решений агента для одной задачи. Все проверки
 * независимы (раздел 2), поэтому выполняются в одном проходе — сбой
 * одной не блокирует остальные. Агент только комментирует/дополняет,
 * никогда не переименовывает, не закрывает, не удаляет и не переназначает.
 */
export async function processTask(taskGid: string): Promise<void> {
  const task = await asana.getTask(taskGid);

  if (task.completed) {
    logger.info("Задача завершена — пропуск", { taskGid });
    return;
  }

  if (task.resource_subtype && IGNORED_SUBTYPES.has(task.resource_subtype)) {
    return;
  }

  const trackedProjectGid = task.projects.find((p) => Boolean(findByGid(p.gid)))?.gid;
  if (!trackedProjectGid) {
    logger.info("Задача вне отслеживаемых проектов Gestión Operativa — пропуск", { taskGid });
    return;
  }

  const stories = await asana.getStories(taskGid);
  const existingCommentTexts = stories
    .filter((s) => s.type === "comment" || s.resource_subtype === "comment_added")
    .map((s) => s.text ?? "");
  const alreadyPosted = (marker: string) => existingCommentTexts.some((t) => t.startsWith(marker));

  await Promise.all([
    checkName(task, alreadyPosted),
    checkNotes(task, alreadyPosted),
    checkDuplicates(task, trackedProjectGid, existingCommentTexts),
    checkAssignee(task, alreadyPosted),
  ]);
}

async function checkName(task: AsanaTask, alreadyPosted: (m: string) => boolean): Promise<void> {
  const result = await checkTaskName(task);
  if (result.valid || alreadyPosted(MARKERS.nameError)) return;

  const project = task.projects.map((p) => findByGid(p.gid)).find(Boolean);
  const code = project?.code ?? "KOD";
  const creatorName = (await asana.getTaskCreatorName(task.gid)) ?? "equipo / команда";

  logger.info("Название не соответствует формату", { taskGid: task.gid, reason: result.reason });
  await asana.addComment(task.gid, nameErrorComment(creatorName, task.name, code));
}

async function checkNotes(task: AsanaTask, alreadyPosted: (m: string) => boolean): Promise<void> {
  const result = await reconcileNotes(task.notes);
  if (result.action === "none" || !result.updatedNotes) return;

  await asana.updateNotes(task.gid, result.updatedNotes);
  logger.info("Notes обновлены", { taskGid: task.gid, action: result.action });

  if (result.action === "added_template" && !alreadyPosted(MARKERS.notesTemplate)) {
    await asana.addComment(task.gid, notesTemplateAddedComment());
  }
}

async function checkDuplicates(
  task: AsanaTask,
  projectGid: string,
  existingCommentTexts: string[],
): Promise<void> {
  const otherTasks = (await asana.getProjectTasks(projectGid)).filter((t) => t.gid !== task.gid);
  const confirmed = await findConfirmedDuplicates(task, otherTasks);

  for (const dup of confirmed) {
    const alreadyMentioned = existingCommentTexts.some((t) => t.includes(dup.task.permalink_url));
    if (alreadyMentioned) continue;

    logger.info("Возможный дубль найден", { taskGid: task.gid, similar: dup.task.gid, reason: dup.reason });
    await asana.addComment(
      task.gid,
      possibleDuplicateComment({
        similarTaskName: dup.task.name,
        similarTaskLink: dup.task.permalink_url,
        assignee: dup.task.assignee?.name ?? "—",
        dueDate: dup.task.due_on ?? "—",
        status: dup.task.completed ? "Completada / Завершена" : "En curso / В работе",
      }),
    );
  }
}

async function checkAssignee(task: AsanaTask, alreadyPosted: (m: string) => boolean): Promise<void> {
  if (task.assignee || alreadyPosted(MARKERS.noAssignee)) return;
  await asana.addComment(task.gid, noAssigneeComment());
}
