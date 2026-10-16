import { asana } from "../asana/client";
import type { AsanaTask } from "../asana/types";
import { logger } from "../logger";
import { findByGid } from "../projectCodes";
import { findConfirmedDuplicates } from "../rules/duplicates";
import { checkTaskName } from "../rules/nameFormat";
import { reconcileNotes } from "../rules/notes";
import {
  duplicateFragment,
  missingFieldsFragment,
  nameAskFragment,
  nameFixedFragment,
  notesNeededFragment,
} from "../templates";

const IGNORED_SUBTYPES = new Set(["milestone", "approval", "section"]);

/**
 * Обрабатывает одну задачу Gestión Operativa: анализирует название, Notes,
 * дубли, исполнителя/срок — и публикует **один** сводный комментарий (если
 * вообще есть что сказать), с @-упоминанием автора задачи, чтобы он получил
 * уведомление. Автоматические действия (перевод Notes, исправление
 * названия, когда суть понятна) выполняются молча — комментарий не про них,
 * а про то, что реально нужно от человека (плюс короткая пометка о
 * переименовании, чтобы не удивлялся).
 *
 * Во всём остальном агент не закрывает, не удаляет и не переназначает
 * задачи.
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

  const [nameResult, notesResult, duplicates] = await Promise.all([
    checkTaskName(task.name),
    reconcileNotes(task.notes),
    findDuplicatesFor(task, trackedProjectGid),
  ]);

  const fragments: string[] = [];

  fragments.push(...(await applyName(task, nameResult, existingCommentTexts)));
  fragments.push(...(await applyNotes(task, notesResult)));
  fragments.push(...newDuplicateFragments(duplicates, existingCommentTexts));
  fragments.push(...missingFieldFragments(task, existingCommentTexts));

  if (fragments.length === 0) return;

  const combined = fragments.join(" ");
  const creator = await asana.getTaskCreator(task.gid);

  logger.info("Публикуется сводный комментарий", { taskGid: task.gid, fragments: fragments.length });
  if (creator) {
    await asana.addMentionComment(task.gid, creator.gid, combined);
  } else {
    await asana.addComment(task.gid, combined);
  }
}

async function findDuplicatesFor(task: AsanaTask, projectGid: string) {
  const otherTasks = (await asana.getProjectTasks(projectGid)).filter((t) => t.gid !== task.gid);
  return findConfirmedDuplicates(task, otherTasks);
}

async function applyName(
  task: AsanaTask,
  result: Awaited<ReturnType<typeof checkTaskName>>,
  existingCommentTexts: string[],
): Promise<string[]> {
  if (result.valid) return [];

  if (result.action === "fix" && result.correctedName) {
    const oldName = task.name;
    await asana.updateName(task.gid, result.correctedName);
    logger.info("Название исправлено автоматически", {
      taskGid: task.gid,
      oldName,
      newName: result.correctedName,
    });
    return [nameFixedFragment(oldName, result.correctedName)];
  }

  // action === "ask" — агент не уверен, что имелось в виду, и не угадывает
  const text = nameAskFragment(task.name, result.reason);
  if (existingCommentTexts.some((t) => t.includes(text))) return [];
  return [text];
}

async function applyNotes(task: AsanaTask, result: Awaited<ReturnType<typeof reconcileNotes>>): Promise<string[]> {
  if (result.action === "none" || !result.updatedNotes) return [];

  await asana.updateNotes(task.gid, result.updatedNotes);
  logger.info("Notes обновлены", { taskGid: task.gid, action: result.action });

  // "added_translation" — тихий перевод, без комментария. Только пустая
  // заготовка с нуля требует внимания человека (нужен сам контекст).
  return result.action === "added_template" ? [notesNeededFragment()] : [];
}

function newDuplicateFragments(
  duplicates: Awaited<ReturnType<typeof findConfirmedDuplicates>>,
  existingCommentTexts: string[],
): string[] {
  const fragments: string[] = [];
  for (const dup of duplicates) {
    const alreadyMentioned = existingCommentTexts.some((t) => t.includes(dup.task.permalink_url));
    if (alreadyMentioned) continue;
    fragments.push(duplicateFragment({ similarTaskName: dup.task.name, similarTaskLink: dup.task.permalink_url }));
  }
  return fragments;
}

function missingFieldFragments(task: AsanaTask, existingCommentTexts: string[]): string[] {
  const missingAssignee = !task.assignee;
  const missingDueDate = !task.due_on;
  if (!missingAssignee && !missingDueDate) return [];

  const text = missingFieldsFragment(missingAssignee, missingDueDate);
  // Сравниваем точный текст, не просто факт "уже было что-то": если человек
  // закрыл только часть (например, назначил исполнителя), набор
  // недостающих полей меняется — это другой текст, и агент должен напомнить
  // про оставшееся, а не замолчать навсегда.
  if (existingCommentTexts.some((t) => t.includes(text))) return [];
  return [text];
}
