import { PULSE_WEEKS, type PulseData, type PulseProject, type PulseTask } from "./types";

const TZ = process.env.PULSE_TZ ?? "Europe/Madrid";
const DAY = 86_400_000;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** YYYY-MM-DD в часовом поясе компании — в том же формате, что due_on в Asana. */
function localDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY);
}

function fmtDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

interface Stats {
  open: number;
  overdue: number;
  dueSoon: number;
  unassigned: number;
  noDue: number;
  done7: number;
  new7: number;
  /** Закрыто по неделям, от самой старой к текущей. */
  doneByWeek: number[];
  /** Закрыто за всё окно PULSE_WEEKS — для кольца прогресса. */
  doneWindow: number;
  health: "red" | "amber" | "green" | "none";
}

interface Ctx {
  today: string;
  weekStarts: string[];
}

function stats(tasks: PulseTask[], ctx: Ctx): Stats {
  const open = tasks.filter((t) => !t.completed);
  const overdue = open.filter((t) => t.dueOn && t.dueOn < ctx.today).length;
  const soonLimit = addDays(ctx.today, 7);
  const weekAgo = addDays(ctx.today, -6);
  const doneDates = tasks.filter((t) => t.completed && t.completedAt).map((t) => localDate(new Date(t.completedAt!)));
  const createdDates = tasks.filter((t) => t.createdAt).map((t) => localDate(new Date(t.createdAt!)));

  const doneByWeek = ctx.weekStarts.map((start, i) => {
    const end = ctx.weekStarts[i + 1] ?? addDays(ctx.today, 1);
    return doneDates.filter((d) => d >= start && d < end).length;
  });

  const ratio = open.length ? overdue / open.length : 0;
  const health = open.length === 0 ? "none" : ratio >= 0.25 ? "red" : ratio >= 0.1 ? "amber" : "green";

  return {
    open: open.length,
    overdue,
    dueSoon: open.filter((t) => t.dueOn && t.dueOn >= ctx.today && t.dueOn <= soonLimit).length,
    unassigned: open.filter((t) => !t.assignee).length,
    noDue: open.filter((t) => !t.dueOn).length,
    done7: doneDates.filter((d) => d >= weekAgo).length,
    new7: createdDates.filter((d) => d >= weekAgo).length,
    doneByWeek,
    doneWindow: doneDates.length,
    health,
  };
}

const HEALTH: Record<Stats["health"], { label: string; cls: string }> = {
  red: { label: "Off track", cls: "red" },
  amber: { label: "At risk", cls: "amber" },
  green: { label: "On track", cls: "green" },
  none: { label: "Нет задач", cls: "grey" },
};

const HEALTH_HINT: Record<Stats["health"], string> = {
  red: "Просрочено ≥ 25% открытых задач",
  amber: "Просрочено ≥ 10% открытых задач",
  green: "Просрочено меньше 10% открытых задач",
  none: "Открытых задач нет",
};

/** Иконка здоровья проекта в духе Linear: кружок с «пульсом» внутри. */
function healthIcon(cls: string): string {
  return `<svg class="hi ${cls}" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7.5h1.8l1-2.5 1.6 4 1-1.5h1.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function ring(pct: number): string {
  const r = 6;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="${r}" class="ring-bg"/><circle cx="8" cy="8" r="${r}" class="ring-fg" stroke-dasharray="${(
    (pct / 100) *
    c
  ).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/></svg>`;
}

/** Статус задачи: просроченная — красный круг, со сроком скоро — полукруг, иначе пустой круг. */
function statusIcon(kind: "overdue" | "soon"): string {
  return kind === "overdue"
    ? `<svg class="si red" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 4v3.5M7 9.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
    : `<svg class="si amber" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 3a4 4 0 0 1 0 8z" fill="currentColor"/></svg>`;
}

const AVATAR_HUES = [262, 200, 150, 30, 340, 95, 15, 225];

function avatar(name: string | null): string {
  if (!name) return `<span class="av none" title="Без исполнителя">–</span>`;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="av" style="--h:${AVATAR_HUES[h % AVATAR_HUES.length]}" title="${esc(name)}">${esc(initials)}</span>`;
}

function spark(values: number[], weekStarts: string[]): string {
  const max = Math.max(1, ...values);
  return `<span class="spark" aria-label="Закрыто по неделям">${values
    .map(
      (v, i) =>
        `<i title="Неделя с ${fmtDate(weekStarts[i])}: закрыто ${v}" style="height:${Math.max(
          8,
          Math.round((v / max) * 100),
        )}%"${v ? "" : ' class="z"'}></i>`,
    )
    .join("")}</span>`;
}

function projectRow(p: PulseProject, s: Stats, ctx: Ctx): string {
  const url = `https://app.asana.com/0/${esc(p.gid)}`;
  if (p.error) {
    return `<a class="row prow" href="${url}" target="_blank" rel="noopener">
      <span class="pname"><span class="pico">${esc(p.code.slice(0, 2))}</span><span class="ttl">${esc(p.shortName)}</span></span>
      <span class="health red" title="${esc(p.error.slice(0, 200))}">${healthIcon("red")}Ошибка чтения</span>
      <span class="c-wide muted">${esc(p.error.slice(0, 80))}</span></a>`;
  }
  const h = HEALTH[s.health];
  const total = s.open + s.doneWindow;
  const pct = total ? Math.round((s.doneWindow / total) * 100) : 0;
  return `<a class="row prow" href="${url}" target="_blank" rel="noopener">
    <span class="pname"><span class="pico">${esc(p.code.slice(0, 2))}</span><span class="ttl">${esc(p.shortName)}</span>${
      p.shortName === p.code ? "" : `<span class="id">${esc(p.code)}</span>`
    }</span>
    <span class="health ${h.cls}" title="${HEALTH_HINT[s.health]}">${healthIcon(h.cls)}${h.label}</span>
    <span class="prog" title="Закрыто ${s.doneWindow} из ${total} задач за ${PULSE_WEEKS} нед.">${ring(pct)}${pct}%</span>
    <span class="num">${s.open}</span>
    <span class="num ${s.overdue ? "red" : "dim"}">${s.overdue}</span>
    <span class="num ${s.dueSoon ? "" : "dim"}">${s.dueSoon}</span>
    <span class="flow" title="За 7 дней: новых ${s.new7}, закрыто ${s.done7}"><b class="${s.done7 >= s.new7 ? "green" : "red"}">${
      s.done7 >= s.new7 ? "↓" : "↑"
    }</b>+${s.new7} / −${s.done7}</span>
    ${spark(s.doneByWeek, ctx.weekStarts)}
  </a>`;
}

interface Row {
  task: PulseTask;
  code: string;
}

function issueList(rows: Row[], kind: "overdue" | "soon", today: string, empty: string): string {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return rows
    .map(({ task, code }) => {
      const due =
        kind === "overdue"
          ? `<span class="chip red">${daysBetween(task.dueOn!, today)} дн.</span>`
          : `<span class="chip">${task.dueOn === today ? "Сегодня" : fmtDate(task.dueOn!)}</span>`;
      return `<a class="row irow" href="${esc(task.url)}" target="_blank" rel="noopener"><span class="id">${esc(code)}</span>${statusIcon(
        kind,
      )}<span class="ttl">${esc(task.name)}</span>${due}${avatar(task.assignee)}</a>`;
    })
    .join("");
}

function stat(label: string, value: number, note: string, tone = ""): string {
  return `<div class="stat"><div class="stat-l">${esc(label)}</div><div class="stat-v ${tone}">${value}</div><div class="stat-n">${esc(note)}</div></div>`;
}

const NAV: { id: string; label: string; key: string; icon: string }[] = [
  { id: "overview", label: "Обзор", key: "1", icon: '<path d="M2 8h3l1.5-4 3 8L11 8h3"/>' },
  { id: "projects", label: "Проекты", key: "2", icon: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 8h5"/>' },
  { id: "overdue", label: "Просрочено", key: "3", icon: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5.2v3.2M8 10.6v.1"/>' },
  { id: "upcoming", label: "Ближайшие 7 дней", key: "4", icon: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>' },
  { id: "team", label: "Команда", key: "5", icon: '<circle cx="6" cy="6" r="2.5"/><path d="M1.8 13c.5-2.2 2.2-3.4 4.2-3.4s3.7 1.2 4.2 3.4M10.5 3.6a2.4 2.4 0 0 1 0 4.8M12 9.8c1.2.5 2 1.6 2.2 3.2"/>' },
];

function sectionHead(id: string, title: string, count?: number): string {
  return `<div class="sh" id="${id}"><span>${esc(title)}</span>${count === undefined ? "" : `<span class="cnt">${count}</span>`}</div>`;
}

export function renderPulse(data: PulseData): string {
  const generated = new Date(data.generatedAt);
  const today = localDate(generated);
  // Недели — скользящие 7-дневные окна, заканчивающиеся сегодня.
  const weekStarts = Array.from({ length: PULSE_WEEKS }, (_, i) => addDays(today, -7 * (PULSE_WEEKS - i) + 1));
  const ctx: Ctx = { today, weekStarts };

  const perProject = data.projects.map((p) => ({ p, s: stats(p.tasks, ctx) }));
  const total = stats(
    data.projects.flatMap((p) => p.tasks),
    ctx,
  );

  const openRows: Row[] = data.projects.flatMap((p) => p.tasks.filter((t) => !t.completed).map((task) => ({ task, code: p.code })));
  const overdueAll = openRows
    .filter((r) => r.task.dueOn && r.task.dueOn < today)
    .sort((a, b) => a.task.dueOn!.localeCompare(b.task.dueOn!));
  const soonLimit = addDays(today, 7);
  const soonAll = openRows
    .filter((r) => r.task.dueOn && r.task.dueOn >= today && r.task.dueOn <= soonLimit)
    .sort((a, b) => a.task.dueOn!.localeCompare(b.task.dueOn!));

  const people = new Map<string | null, { open: number; overdue: number }>();
  for (const { task } of openRows) {
    const v = people.get(task.assignee) ?? { open: 0, overdue: 0 };
    v.open++;
    if (task.dueOn && task.dueOn < today) v.overdue++;
    people.set(task.assignee, v);
  }
  const team = [...people.entries()].sort((a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open).slice(0, 15);
  const maxOpen = Math.max(1, ...team.map(([, v]) => v.open));

  const updated = generated.toLocaleString("ru-RU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
  const overduePct = total.open ? Math.round((total.overdue / total.open) * 100) : 0;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Пульс Prestige Expo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;--bg:#08090a;--panel:#0f1011;--hover:#16171a;--line:#1f2023;--line2:#2a2b30;--fg:#f7f8f8;--fg2:#d0d6e0;--muted:#8a8f98;--dim:#62666d;--accent:#7170ff;--red:#eb5757;--amber:#f2994a;--green:#4cb782;--grey:#62666d}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){color-scheme:light;--bg:#fcfcfd;--panel:#f4f5f8;--hover:#eef0f3;--line:#e9eaee;--line2:#dcdee4;--fg:#1b1c1f;--fg2:#3c3f46;--muted:#6b6f76;--dim:#9a9ea6;--accent:#5e6ad2;--red:#d1453b;--amber:#d9822b;--green:#2f9e6a;--grey:#a0a4ab}}
:root[data-theme="light"]{color-scheme:light;--bg:#fcfcfd;--panel:#f4f5f8;--hover:#eef0f3;--line:#e9eaee;--line2:#dcdee4;--fg:#1b1c1f;--fg2:#3c3f46;--muted:#6b6f76;--dim:#9a9ea6;--accent:#5e6ad2;--red:#d1453b;--amber:#d9822b;--green:#2f9e6a;--grey:#a0a4ab}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:56px}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
a{color:inherit;text-decoration:none}
.app{display:flex;min-height:100vh}
aside{width:224px;flex:none;position:sticky;top:0;height:100vh;padding:12px 10px;border-right:1px solid var(--line);background:var(--panel)}
.ws{display:flex;align-items:center;gap:8px;padding:6px 8px 14px;font-weight:600;font-size:13px}
.ws-logo{width:20px;height:20px;border-radius:5px;background:linear-gradient(135deg,var(--accent),#c165dd);display:grid;place-items:center;font-size:11px;color:#fff}
nav a{display:flex;align-items:center;gap:9px;padding:5px 8px;border-radius:6px;color:var(--fg2);font-weight:500}
nav a:hover,nav a.on{background:var(--hover);color:var(--fg)}
nav svg{width:16px;height:16px;fill:none;stroke:var(--muted);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
nav kbd{margin-left:auto;font:500 11px Inter,sans-serif;color:var(--dim);border:1px solid var(--line2);border-radius:4px;padding:0 5px}
.side-foot{position:absolute;bottom:14px;left:18px;right:18px;font-size:11px;color:var(--dim)}
main{flex:1;min-width:0}
.top{position:sticky;top:0;z-index:2;height:44px;display:flex;align-items:center;gap:8px;padding:0 24px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(12px)}
.crumb{color:var(--muted)}.crumb b{color:var(--fg);font-weight:500}
.top .upd{margin-left:auto;white-space:nowrap;overflow:hidden;color:var(--dim);font-size:12px;display:flex;align-items:center;gap:6px}
.live{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 25%,transparent)}
.content{padding:20px 24px 64px;max-width:1180px}
.stats{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line);border-radius:10px;background:var(--panel);overflow:hidden}
.stat{padding:14px 16px;border-left:1px solid var(--line)}.stat:first-child{border-left:0}
.stat-l{color:var(--muted);font-size:12px}
.stat-v{font-size:24px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:2px 0}
.stat-n{color:var(--dim);font-size:12px}
.sh{display:flex;align-items:center;gap:8px;margin:28px 0 0;padding:8px 12px;background:var(--panel);border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;font-weight:500;color:var(--fg2)}
.cnt{color:var(--dim);font-weight:400}
.list{border:1px solid var(--line);border-radius:0 0 8px 8px;overflow:hidden}
.colh,.row{display:grid;align-items:center;gap:12px;padding:0 12px;min-height:44px;border-top:1px solid var(--line)}
.colh{min-height:30px;color:var(--dim);font-size:12px;border-top:0}
.row:hover{background:var(--hover)}
.prow,.colh.p{grid-template-columns:minmax(180px,1.6fr) 120px 70px 56px 64px 56px 110px 76px}
.irow{grid-template-columns:44px 14px minmax(0,1fr) auto 22px;min-height:40px}
.trow{grid-template-columns:22px minmax(120px,1fr) minmax(80px,1.4fr) 64px 64px;min-height:40px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.pname{display:flex;align-items:center;gap:10px;min-width:0}
.pico{width:22px;height:22px;flex:none;border-radius:6px;display:grid;place-items:center;font-size:10px;font-weight:600;color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.ttl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.id{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.health{display:inline-flex;align-items:center;gap:6px;font-weight:500;white-space:nowrap}
.hi,.si{width:14px;height:14px;flex:none}
.red{color:var(--red)}.amber{color:var(--amber)}.green{color:var(--green)}.grey,.dim{color:var(--dim)}.muted{color:var(--muted)}
.prog{display:inline-flex;align-items:center;gap:6px;color:var(--fg2);font-variant-numeric:tabular-nums}
.ring{width:16px;height:16px}.ring circle{fill:none;stroke-width:2.2}.ring-bg{stroke:var(--line2)}.ring-fg{stroke:var(--accent);stroke-linecap:round}
.flow{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}.flow b{margin-right:4px}
.spark{display:flex;align-items:flex-end;gap:2px;height:18px}
.spark i{width:9px;border-radius:2px;background:var(--accent);opacity:.8}.spark i.z{background:var(--line2);opacity:1}
.chip{font-size:12px;padding:1px 7px;border:1px solid var(--line2);border-radius:999px;color:var(--fg2);white-space:nowrap;font-variant-numeric:tabular-nums}
.chip.red{color:var(--red);border-color:color-mix(in srgb,var(--red) 35%,transparent)}
.av{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:600;color:#fff;background:hsl(var(--h) 55% 50%)}
.av.none{background:transparent;border:1px dashed var(--dim);color:var(--dim)}
.bar{height:6px;border-radius:3px;background:var(--line2);overflow:hidden;display:flex}
.bar i{display:block;height:100%;background:var(--accent);opacity:.8}.bar i.o{background:var(--red);opacity:1}
.empty{padding:14px 12px;color:var(--dim);border-top:1px solid var(--line)}
.c-wide{grid-column:span 6;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.more{padding:9px 12px;color:var(--dim);font-size:12px;border-top:1px solid var(--line)}
footer{margin-top:32px;color:var(--dim);font-size:12px}
@media (max-width:1100px){.two{grid-template-columns:1fr}}
@media (max-width:860px){
  aside{display:none}.top{padding:0 16px}.content{padding:16px 16px 48px}
  .stats{grid-template-columns:1fr 1fr}.stat{border-top:1px solid var(--line)}.stat:nth-child(odd){border-left:0}.stat:nth-child(-n+2){border-top:0}.stat:last-child{grid-column:span 2}
  .colh.p{display:none}
  .prow{grid-template-columns:1fr auto;row-gap:2px;padding:10px 12px}
  .prow .num,.prow .flow{display:none}.prow .prog{grid-column:2;grid-row:1}.prow .health{grid-row:2}.prow .spark{grid-row:2;grid-column:2;justify-self:end}
  .c-wide{grid-column:1/-1}
  .trow{grid-template-columns:22px minmax(0,1fr) 56px 56px}.trow .bar{display:none}
}
</style>
</head>
<body>
<div class="app">
<aside>
  <div class="ws"><span class="ws-logo">P</span>Prestige Expo</div>
  <nav>${NAV.map(
    (n) => `<a href="#${n.id}" data-key="${n.key}"><svg viewBox="0 0 16 16">${n.icon}</svg>${esc(n.label)}<kbd>${n.key}</kbd></a>`,
  ).join("")}</nav>
  <div class="side-foot">Asanchez · данные из Asana</div>
</aside>
<main>
<div class="top"><span class="crumb">Prestige Expo › <b>Пульс</b></span><span class="upd"><span class="live"></span>Обновлено ${esc(updated)}</span></div>
<div class="content">

<div id="overview" class="stats">
${stat("Открыто", total.open, `в ${data.projects.length} проектах`)}
${stat("Просрочено", total.overdue, `${overduePct}% от открытых`, total.overdue ? "red" : "")}
${stat("Срок ≤ 7 дней", total.dueSoon, "ближайшая неделя")}
${stat("Закрыто за 7 дней", total.done7, `новых: ${total.new7}`, total.done7 >= total.new7 ? "green" : "")}
${stat("Без исполнителя / срока", total.unassigned + total.noDue, `${total.unassigned} · ${total.noDue}`)}
</div>

${sectionHead("projects", "Проекты", data.projects.length)}
<div class="list">
<div class="colh p"><span>Название</span><span>Здоровье</span><span>Прогресс</span><span class="num">Открыто</span><span class="num">Просроч.</span><span class="num">≤ 7 дн.</span><span>7 дней</span><span>${PULSE_WEEKS} нед.</span></div>
${perProject.map(({ p, s }) => projectRow(p, s, ctx)).join("\n")}
</div>

<div class="two">
<div>
${sectionHead("overdue", "Просрочено", overdueAll.length)}
<div class="list">${issueList(overdueAll.slice(0, 20), "overdue", today, "Просроченных задач нет.")}${
    overdueAll.length > 20 ? `<div class="more">и ещё ${overdueAll.length - 20}</div>` : ""
  }</div>
</div>
<div>
${sectionHead("upcoming", "Ближайшие 7 дней", soonAll.length)}
<div class="list">${issueList(soonAll.slice(0, 20), "soon", today, "На ближайшую неделю сроков нет.")}${
    soonAll.length > 20 ? `<div class="more">и ещё ${soonAll.length - 20}</div>` : ""
  }</div>
</div>
</div>

${sectionHead("team", "Команда", team.length)}
<div class="list">${
    team
      .map(
        ([name, v]) =>
          `<div class="row trow">${avatar(name)}<span class="ttl">${esc(name ?? "Без исполнителя")}</span><span class="bar"><i class="o" style="width:${(
            (v.overdue / maxOpen) *
            100
          ).toFixed(1)}%"></i><i style="width:${(((v.open - v.overdue) / maxOpen) * 100).toFixed(1)}%"></i></span><span class="num">${
            v.open
          } откр.</span><span class="num ${v.overdue ? "red" : "dim"}">${v.overdue} проср.</span></div>`,
      )
      .join("") || `<div class="empty">Открытых задач нет.</div>`
  }</div>

<footer>Собрано агентом Asanchez из Asana: проекты Gestión Operativa из config/projectCodes.json, задачи верхнего уровня без подзадач. Прогресс — доля закрытых из всех задач за ${PULSE_WEEKS} нед.</footer>
</div>
</main>
</div>
<script>
// Навигация с клавиатуры, как в Linear: 1–5 — к разделу; подсветка текущего раздела в сайдбаре.
(function(){
  var links=[].slice.call(document.querySelectorAll("nav a"));
  document.addEventListener("keydown",function(e){
    if(e.metaKey||e.ctrlKey||e.altKey||/input|textarea/i.test(e.target.tagName))return;
    var a=links.filter(function(l){return l.dataset.key===e.key})[0];
    if(a){e.preventDefault();document.getElementById(a.getAttribute("href").slice(1)).scrollIntoView();}
  });
  if(!("IntersectionObserver" in window))return;
  var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting)links.forEach(function(l){l.classList.toggle("on",l.getAttribute("href")==="#"+en.target.id)})})},{rootMargin:"-45% 0px -50% 0px"});
  links.forEach(function(l){var t=document.getElementById(l.getAttribute("href").slice(1));if(t)io.observe(t)});
})();
</script>
</body>
</html>
`;
}
