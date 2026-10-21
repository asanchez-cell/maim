// Отдельно от collect.ts, чтобы рендер не тянул клиент Asana (и его обязательные env).

/** Сколько недель истории закрытых/созданных задач показывает дашборд. */
export const PULSE_WEEKS = 6;

export interface PulseTask {
  gid: string;
  name: string;
  url: string;
  assignee: string | null;
  dueOn: string | null;
  completed: boolean;
  createdAt: string | null;
  completedAt: string | null;
}

export interface PulseProject {
  code: string;
  shortName: string;
  name: string;
  gid: string;
  /** Пусто, если проект не удалось прочитать (ошибка Asana API) — карточка покажет это. */
  error?: string;
  tasks: PulseTask[];
}

export interface PulseData {
  generatedAt: string;
  projects: PulseProject[];
}
