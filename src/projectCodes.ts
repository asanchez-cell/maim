import registry from "../config/projectCodes.json";

export interface ProjectCodeEntry {
  code: string;
  asanaProjectName: string;
  shortName: string;
  asanaProjectGid: string;
  operational: boolean;
  enabled: boolean;
}

const entries: ProjectCodeEntry[] = registry.projects;

/**
 * "Actas de reuniones" — общий проект для протоколов встреч всех кодов
 * (не привязан к одному коду, поэтому хранится отдельно от registry.projects).
 * Управляется отдельным флагом actasEnabled в конфиге.
 */
const ACTAS_PROJECT: ProjectCodeEntry | null = registry.actasProjectGid
  ? {
      code: "ACTAS",
      asanaProjectName: registry.actasProjectName ?? "Actas de reuniones",
      shortName: registry.actasProjectName ?? "Actas de reuniones",
      asanaProjectGid: registry.actasProjectGid,
      operational: true,
      enabled: Boolean(registry.actasEnabled),
    }
  : null;

/** Полный справочник как есть в конфиге, без фильтрации по enabled — для справки/админ-инструментов. */
export function allProjects(): ProjectCodeEntry[] {
  return entries;
}

/**
 * Проекты, которые агент реально отслеживает прямо сейчас: operational,
 * с заполненным GID и явно включённые (enabled=true). Это единственный
 * рубильник постепенного раскатывания на новые проекты.
 */
export function operationalProjects(): ProjectCodeEntry[] {
  return entries.filter((p) => p.operational && p.enabled && p.asanaProjectGid);
}

export function actasProject(): ProjectCodeEntry | null {
  return ACTAS_PROJECT && ACTAS_PROJECT.enabled ? ACTAS_PROJECT : null;
}

/** Проекты, которые должен отслеживать агент: включённые коды Gestión Operativa + Actas de reuniones. */
export function trackedProjects(): ProjectCodeEntry[] {
  const actas = actasProject();
  return actas ? [...operationalProjects(), actas] : operationalProjects();
}

/** Ищет проект среди включённых (enabled) — именно это определяет, отслеживает ли агент задачу. */
export function findByGid(projectGid: string): ProjectCodeEntry | undefined {
  return trackedProjects().find((p) => p.asanaProjectGid === projectGid);
}

export function findByCode(code: string): ProjectCodeEntry | undefined {
  return entries.find((p) => p.code === code);
}

export function allKnownCodes(): string[] {
  return entries.map((p) => p.code);
}
