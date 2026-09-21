export interface AsanaUserRef {
  gid: string;
  name: string;
}

export interface AsanaProjectRef {
  gid: string;
  name: string;
}

export interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  html_notes?: string;
  completed: boolean;
  resource_subtype?: string;
  assignee: AsanaUserRef | null;
  due_on: string | null;
  parent: { gid: string; name: string } | null;
  projects: AsanaProjectRef[];
  permalink_url: string;
}

export interface AsanaStory {
  gid: string;
  type: string;
  resource_subtype: string;
  text: string;
  created_at: string;
  created_by: AsanaUserRef | null;
}

export interface AsanaWebhook {
  gid: string;
  resource: { gid: string; name: string };
  target: string;
  active: boolean;
}

export interface AsanaEvent {
  action: string;
  resource: { gid: string; resource_type: string; resource_subtype?: string };
  parent?: { gid: string; resource_type: string } | null;
  created_at: string;
}

export interface AsanaEventsResult {
  events: AsanaEvent[];
  sync: string;
  /** true, если это была первая синхронизация (или старый sync истёк) — событий за прошлое нет. */
  needsResync: boolean;
}
