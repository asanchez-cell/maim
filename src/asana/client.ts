import { config } from "../config";
import { logger } from "../logger";
import type { AsanaEventsResult, AsanaStory, AsanaTask, AsanaWebhook } from "./types";

const BASE_URL = "https://app.asana.com/api/1.0";

const TASK_OPT_FIELDS = [
  "name",
  "notes",
  "completed",
  "resource_subtype",
  "assignee.gid",
  "assignee.name",
  "due_on",
  "parent.gid",
  "parent.name",
  "projects.gid",
  "projects.name",
  "permalink_url",
].join(",");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.asana.accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Asana API ${init.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json = (await res.json()) as { data: T };
  return json.data;
}

export const asana = {
  async getTask(taskGid: string): Promise<AsanaTask> {
    return request<AsanaTask>(`/tasks/${taskGid}?opt_fields=${TASK_OPT_FIELDS}`);
  },

  async getProjectTasks(projectGid: string): Promise<AsanaTask[]> {
    const tasks: AsanaTask[] = [];
    let path: string | null =
      `/projects/${projectGid}/tasks?completed_since=now&opt_fields=${TASK_OPT_FIELDS}&limit=100`;

    while (path) {
      const res: { data: AsanaTask[]; next_page: { path: string } | null } = await requestPage(path);
      tasks.push(...res.data);
      path = res.next_page ? res.next_page.path.replace(BASE_URL, "") : null;
    }

    return tasks;
  },

  /**
   * Для дашборда «Пульс»: все незакрытые задачи проекта плюс закрытые после
   * `since` (так считается, сколько закрыли за последние недели).
   */
  async getProjectPulseTasks(projectGid: string, since: string): Promise<AsanaTask[]> {
    const fields = `${TASK_OPT_FIELDS},created_at,completed_at`;
    const tasks: AsanaTask[] = [];
    let path: string | null =
      `/projects/${projectGid}/tasks?completed_since=${encodeURIComponent(since)}&opt_fields=${fields}&limit=100`;

    while (path) {
      const res: { data: AsanaTask[]; next_page: { path: string } | null } = await requestPage(path);
      tasks.push(...res.data);
      path = res.next_page ? res.next_page.path.replace(BASE_URL, "") : null;
    }

    return tasks;
  },

  /** Задачи проекта, изменённые после `since` — нужно для поиска новых комментариев (раздел про упоминания). */
  async getTasksModifiedSince(projectGid: string, since: string): Promise<AsanaTask[]> {
    const tasks: AsanaTask[] = [];
    let path: string | null =
      `/tasks?project=${projectGid}&modified_since=${encodeURIComponent(since)}&opt_fields=${TASK_OPT_FIELDS}&limit=100`;

    while (path) {
      const res: { data: AsanaTask[]; next_page: { path: string } | null } = await requestPage(path);
      tasks.push(...res.data);
      path = res.next_page ? res.next_page.path.replace(BASE_URL, "") : null;
    }

    return tasks;
  },

  async addComment(taskGid: string, text: string): Promise<void> {
    await request(`/tasks/${taskGid}/stories`, {
      method: "POST",
      body: JSON.stringify({ data: { text } }),
    });
    logger.info("Комментарий добавлен", { taskGid });
  },

  /**
   * Комментарий с @-упоминанием автора задачи (он получает уведомление от
   * Asana). "text" идёт сразу после упоминания одним плавным сообщением.
   */
  async addMentionComment(taskGid: string, mentionGid: string, text: string): Promise<void> {
    const html = `<body><a data-asana-gid="${mentionGid}"/>: ${escapeHtml(text)}</body>`;
    await request(`/tasks/${taskGid}/stories`, {
      method: "POST",
      body: JSON.stringify({ data: { html_text: html } }),
    });
    logger.info("Комментарий с упоминанием добавлен", { taskGid, mentionGid });
  },

  async getStories(taskGid: string): Promise<AsanaStory[]> {
    return request<AsanaStory[]>(
      `/tasks/${taskGid}/stories?opt_fields=type,resource_subtype,text,html_text,created_at,created_by.gid,created_by.name`,
    );
  },

  async updateNotes(taskGid: string, notes: string): Promise<void> {
    await request(`/tasks/${taskGid}`, {
      method: "PUT",
      body: JSON.stringify({ data: { notes } }),
    });
    logger.info("Описание задачи обновлено", { taskGid });
  },

  async updateName(taskGid: string, name: string): Promise<void> {
    await request(`/tasks/${taskGid}`, {
      method: "PUT",
      body: JSON.stringify({ data: { name } }),
    });
    logger.info("Название задачи исправлено", { taskGid });
  },

  async setAssignee(taskGid: string, assigneeGid: string): Promise<void> {
    await request(`/tasks/${taskGid}`, {
      method: "PUT",
      body: JSON.stringify({ data: { assignee: assigneeGid } }),
    });
    logger.info("Исполнитель назначен", { taskGid, assigneeGid });
  },

  async setDueOn(taskGid: string, dueOn: string): Promise<void> {
    await request(`/tasks/${taskGid}`, {
      method: "PUT",
      body: JSON.stringify({ data: { due_on: dueOn } }),
    });
    logger.info("Срок установлен", { taskGid, dueOn });
  },

  /**
   * Участники проекта — для резолвинга имени, названного в упоминании
   * ("назначь на Лауру"), только среди реально работающих над этим
   * проектом людей, а не по всему воркспейсу (где тёзок/похожих имён может
   * быть много).
   */
  async getProjectMembers(projectGid: string): Promise<{ gid: string; name: string }[]> {
    const project = await request<{ members: { gid: string; name: string }[] }>(
      `/projects/${projectGid}?opt_fields=members.gid,members.name`,
    );
    return project.members ?? [];
  },

  async createWebhook(resourceGid: string, target: string): Promise<AsanaWebhook> {
    return request<AsanaWebhook>(`/webhooks`, {
      method: "POST",
      body: JSON.stringify({ data: { resource: resourceGid, target } }),
    });
  },

  async listWebhooks(workspaceGid: string): Promise<AsanaWebhook[]> {
    return request<AsanaWebhook[]>(`/webhooks?workspace=${workspaceGid}`);
  },

  /** Собственный пользователь токена — нужен, чтобы узнать свой gid (для обнаружения упоминаний бота). */
  async getMe(): Promise<{ gid: string; name: string }> {
    return request<{ gid: string; name: string }>(`/users/me?opt_fields=gid,name`);
  },

  async getWorkspaceGid(): Promise<string> {
    const me = await request<{ workspaces: { gid: string; name: string }[] }>(
      `/users/me?opt_fields=workspaces.gid,workspaces.name`,
    );
    if (!me.workspaces.length) {
      throw new Error("У этого токена нет доступных workspace в Asana");
    }
    return me.workspaces[0].gid;
  },

  async findTaskByName(projectGid: string, name: string): Promise<AsanaTask | undefined> {
    const tasks = await asana.getProjectTasks(projectGid);
    return tasks.find((t) => t.name === name);
  },

  async createTask(projectGid: string, name: string, notes: string): Promise<AsanaTask> {
    return request<AsanaTask>(`/tasks`, {
      method: "POST",
      body: JSON.stringify({ data: { name, notes, projects: [projectGid] } }),
    });
  },

  /**
   * created_by — не гарантированное поле на всех тарифах Asana, поэтому
   * запрашивается отдельно и не валит основной getTask при отсутствии.
   * gid нужен для @-упоминания (чтобы автор получил уведомление).
   */
  async getTaskCreator(taskGid: string): Promise<{ gid: string; name: string } | null> {
    try {
      const t = await request<{ created_by: { gid: string; name: string } | null }>(
        `/tasks/${taskGid}?opt_fields=created_by.gid,created_by.name`,
      );
      return t.created_by ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Events API — используется для поллинга вместо постоянного вебхук-сервера
   * (GitHub Actions по расписанию). Без sync-токена или с устаревшим токеном
   * Asana отвечает 412 и отдаёт свежий токен без списка событий — это и есть
   * "первичная синхронизация", после которой начинают приходить настоящие события.
   */
  async getEvents(resourceGid: string, syncToken?: string): Promise<AsanaEventsResult> {
    const query = syncToken ? `&sync=${encodeURIComponent(syncToken)}` : "";
    const res = await fetch(`${BASE_URL}/events?resource=${resourceGid}${query}`, {
      headers: { Authorization: `Bearer ${config.asana.accessToken}` },
    });

    const body = (await res.json().catch(() => ({}))) as { data?: AsanaEventsResult["events"]; sync?: string };

    if (res.status === 412) {
      if (!body.sync) {
        throw new Error(`Asana Events API вернул 412 без sync-токена для ресурса ${resourceGid}`);
      }
      return { events: [], sync: body.sync, needsResync: true };
    }

    if (!res.ok) {
      throw new Error(`Asana API GET /events -> ${res.status}: ${JSON.stringify(body)}`);
    }

    return { events: body.data ?? [], sync: body.sync ?? "", needsResync: false };
  },
};

async function requestPage(path: string): Promise<{
  data: import("./types").AsanaTask[];
  next_page: { path: string } | null;
}> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${config.asana.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Asana API GET ${path} -> ${res.status}: ${body}`);
  }
  return res.json() as Promise<{
    data: import("./types").AsanaTask[];
    next_page: { path: string } | null;
  }>;
}
