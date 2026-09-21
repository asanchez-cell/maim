import registry from "../config/projectCodes.json";

export interface ProjectCodeEntry {
  code: string;
  asanaProjectName: string;
  shortName: string;
  asanaProjectGid: string;
  operational: boolean;
}

const entries: ProjectCodeEntry[] = registry.projects;

export function allProjects(): ProjectCodeEntry[] {
  return entries;
}

export function operationalProjects(): ProjectCodeEntry[] {
  return entries.filter((p) => p.operational && p.asanaProjectGid);
}

export function findByGid(projectGid: string): ProjectCodeEntry | undefined {
  return entries.find((p) => p.asanaProjectGid === projectGid);
}

export function findByCode(code: string): ProjectCodeEntry | undefined {
  return entries.find((p) => p.code === code);
}

export function allKnownCodes(): string[] {
  return entries.map((p) => p.code);
}
