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
    health,
  };
}

const HEALTH_LABEL: Record<Stats["health"], string> = {
  red: "Много просрочек",
  amber: "Есть просрочки",
  green: "В норме",
  none: "Нет открытых задач",
};

function kpi(label: string, value: number, note = "", tone = ""): string {
  return `<div class="kpi ${tone}"><div class="kpi-v">${value}</div><div class="kpi-l">${esc(label)}</div>${
    note ? `<div class="kpi-n">${esc(note)}</div>` : ""
  }</div>`;
}

function bars(values: number[], weekStarts: string[]): string {
  const max = Math.max(1, ...values);
  const cols = values
    .map(
      (v, i) =>
        `<div class="bar" title="Неделя с ${fmtDate(weekStarts[i])}: закрыто ${v}"><span style="height:${Math.round(
          (v / max) * 100,
        )}%"></span></div>`,
    )
    .join("");
  return `<div class="bars" aria-label="Закрыто задач по неделям">${cols}</div>`;
}

function projectCard(p: PulseProject, s: Stats, ctx: Ctx): string {
  const title = `<div class="card-h"><span class="dot ${p.error ? "red" : s.health}"></span><div><div class="card-t">${esc(
    p.shortName,
  )} <span class="code">${esc(p.code)}</span></div><div class="card-s">${esc(
    p.error ? "Не удалось прочитать проект" : HEALTH_LABEL[s.health],
  )}</div></div><a class="ext" href="https://app.asana.com/0/${esc(p.gid)}" target="_blank" rel="noopener">Asana ↗</a></div>`;
  if (p.error) return `<section class="card">${title}<p class="muted small">${esc(p.error.slice(0, 200))}</p></section>`;

  const flow = s.done7 - s.new7;
  return `<section class="card">${title}
    <div class="nums">
      <div><b>${s.open}</b><span>открыто</span></div>
      <div class="${s.overdue ? "neg" : ""}"><b>${s.overdue}</b><span>просрочено</span></div>
      <div><b>${s.dueSoon}</b><span>срок ≤ 7 дн.</span></div>
    </div>
    <div class="flow">За 7 дней: +${s.new7} новых, −${s.done7} закрыто <span class="${flow > 0 ? "pos" : flow < 0 ? "neg" : "muted"}">(${
      flow > 0 ? "бэклог тает" : flow < 0 ? "бэклог растёт" : "без изменений"
    })</span></div>
    ${bars(s.doneByWeek, ctx.weekStarts)}
    <div class="muted small">Закрыто по неделям, ${PULSE_WEEKS} нед. · без исполнителя: ${s.unassigned} · без срока: ${s.noDue}</div>
  </section>`;
}

interface Row {
  task: PulseTask;
  code: string;
}

function taskTable(rows: Row[], dateCell: (t: PulseTask) => string, empty: string): string {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<table><tbody>${rows
    .map(
      ({ task, code }) =>
        `<tr><td class="code">${esc(code)}</td><td><a href="${esc(task.url)}" target="_blank" rel="noopener">${esc(
          task.name,
        )}</a></td><td class="muted">${esc(task.assignee ?? "— без исполнителя")}</td><td class="num">${dateCell(task)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
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
  const overdueRows = openRows
    .filter((r) => r.task.dueOn && r.task.dueOn < today)
    .sort((a, b) => a.task.dueOn!.localeCompare(b.task.dueOn!))
    .slice(0, 20);
  const soonLimit = addDays(today, 7);
  const soonRows = openRows
    .filter((r) => r.task.dueOn && r.task.dueOn >= today && r.task.dueOn <= soonLimit)
    .sort((a, b) => a.task.dueOn!.localeCompare(b.task.dueOn!))
    .slice(0, 20);

  const people = new Map<string, { open: number; overdue: number }>();
  for (const { task } of openRows) {
    const key = task.assignee ?? "— без исполнителя";
    const v = people.get(key) ?? { open: 0, overdue: 0 };
    v.open++;
    if (task.dueOn && task.dueOn < today) v.overdue++;
    people.set(key, v);
  }
  const team = [...people.entries()].sort((a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open).slice(0, 15);
  const maxOpen = Math.max(1, ...team.map(([, v]) => v.open));

  const updated = generated.toLocaleString("ru-RU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Пульс Prestige Expo</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--accent:#2f6fde;--red:#d1453b;--amber:#d99a1e;--green:#2e9e5b;--grey:#a3a29c}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--fg:#ecebe6;--muted:#9b9a94;--line:#2e2e2b;--accent:#7aa5f0;--red:#ec6a60;--amber:#e8b44a;--green:#4cc27e;--grey:#5f5e59}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1120px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:20px}
h1{font-size:24px;margin:0}
h2{font-size:17px;margin:32px 0 12px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.muted{color:var(--muted)}.small{font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi-v{font-size:30px;font-weight:650;font-variant-numeric:tabular-nums}
.kpi-l{color:var(--muted);font-size:13px}.kpi-n{font-size:12px;color:var(--muted);margin-top:4px}
.kpi.bad .kpi-v,.neg,.neg b{color:var(--red)}.pos{color:var(--green)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card-h{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px}
.card-h>div{flex:1;min-width:0}.card-t{font-weight:600}.card-s{font-size:13px;color:var(--muted)}
.ext{font-size:13px;white-space:nowrap}
.code{font:600 11px ui-monospace,Menlo,monospace;color:var(--muted);letter-spacing:.03em}
.dot{width:10px;height:10px;border-radius:50%;margin-top:6px;flex:none;background:var(--grey)}
.dot.red{background:var(--red)}.dot.amber{background:var(--amber)}.dot.green{background:var(--green)}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.nums b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.nums span{font-size:12px;color:var(--muted)}
.flow{font-size:13px;margin-bottom:10px}
.bars{display:flex;gap:4px;align-items:flex-end;height:36px;margin-bottom:6px}
.bar{flex:1;height:100%;display:flex;align-items:flex-end}
.bar span{display:block;width:100%;min-height:2px;background:var(--accent);border-radius:3px 3px 0 0;opacity:.85}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px 16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 8px 9px 0;border-top:1px solid var(--line);vertical-align:top}
tr:first-child td{border-top:0}
td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:0 24px}
.load{display:flex;align-items:center;gap:8px}
.load i{display:block;height:8px;border-radius:4px;background:var(--accent);opacity:.6}
.load i.o{background:var(--red);opacity:.9}
footer{margin-top:40px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<main>
<header><h1>Пульс Prestige Expo</h1><div class="muted small">Обновлено ${esc(updated)} · проектов: ${data.projects.length}</div></header>

<div class="kpis">
${kpi("Открытых задач", total.open)}
${kpi("Просрочено", total.overdue, total.open ? `${Math.round((total.overdue / total.open) * 100)}% от открытых` : "", total.overdue ? "bad" : "")}
${kpi("Срок в ближайшие 7 дней", total.dueSoon)}
${kpi("Закрыто за 7 дней", total.done7, `новых за 7 дней: ${total.new7}`)}
${kpi("Без исполнителя / срока", total.unassigned + total.noDue, `${total.unassigned} без исполнителя · ${total.noDue} без срока`)}
</div>

<h2>Проекты</h2>
<div class="grid">
${perProject.map(({ p, s }) => projectCard(p, s, ctx)).join("\n")}
</div>

<div class="two">
<div>
<h2>Просрочено</h2>
<div class="panel">${taskTable(overdueRows, (t) => `<span class="neg">${daysBetween(t.dueOn!, today)} дн.</span>`, "Просроченных задач нет.")}</div>
</div>
<div>
<h2>Ближайшие 7 дней</h2>
<div class="panel">${taskTable(soonRows, (t) => (t.dueOn === today ? "сегодня" : fmtDate(t.dueOn!)), "На ближайшую неделю сроков нет.")}</div>
</div>
</div>

<h2>Нагрузка команды</h2>
<div class="panel"><table><tbody>${
    team
      .map(
        ([name, v]) =>
          `<tr><td>${esc(name)}</td><td style="width:45%"><div class="load"><i style="width:${Math.round(
            (v.open / maxOpen) * 100,
          )}%"></i></div></td><td class="num">${v.open} откр.</td><td class="num ${v.overdue ? "neg" : "muted"}">${v.overdue} проср.</td></tr>`,
      )
      .join("") || `<tr><td class="muted">Открытых задач нет.</td></tr>`
  }</tbody></table></div>

<footer>Собрано агентом Asanchez из Asana: проекты Gestión Operativa, которые он отслеживает (config/projectCodes.json). Учитываются задачи верхнего уровня, без подзадач.</footer>
</main>
</body>
</html>
`;
}
