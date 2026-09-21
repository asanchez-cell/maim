import { config } from "../config";
import { logger } from "../logger";
import type { AsanaStory, AsanaTask, AsanaWebhook } from "./types";

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

  async addComment(taskGid: string, text: string): Promise<void> {
    await request(`/tasks/${taskGid}/stories`, {
      method: "POST",
      body: JSON.stringify({ data: { text } }),
    });
    logger.info("Комментарий добавлен", { taskGid });
  },

  async getStories(taskGid: string): Promise<AsanaStory[]> {
    return request<AsanaStory[]>(
      `/tasks/${taskGid}/stories?opt_fields=type,resource_subtype,text,created_at,created_by.gid,created_by.name`,
    );
  },

  async updateNotes(taskGid: string, notes: string): Promise<void> {
    await request(`/tasks/${taskGid}`, {
      method: "PUT",
      body: JSON.stringify({ data: { notes } }),
    });
    logger.info("Описание задачи обновлено", { taskGid });
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
   */
  async getTaskCreatorName(taskGid: string): Promise<string | null> {
    try {
      const t = await request<{ created_by: { name: string } | null }>(
        `/tasks/${taskGid}?opt_fields=created_by.name`,
      );
      return t.created_by?.name ?? null;
    } catch {
      return null;
    }
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
