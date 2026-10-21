/**
 * Сборка дашборда «Пульс» — вызывается из .github/workflows/pulse.yml.
 * Пишет site/index.html (сама страница, данные вшиты) и site/pulse.json.
 *
 * PULSE_INPUT=путь/к/pulse.json — перерисовать страницу из сохранённых
 * данных без обращения к Asana (удобно править вёрстку локально).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPulse } from "../pulse/render";
import type { PulseData } from "../pulse/types";

const OUT_DIR = process.env.PULSE_OUT_DIR ?? "site";

async function main(): Promise<void> {
  let data: PulseData;
  if (process.env.PULSE_INPUT) {
    data = JSON.parse(readFileSync(process.env.PULSE_INPUT, "utf8")) as PulseData;
  } else {
    // Импорт здесь, а не наверху: клиенту Asana нужны env-переменные, офлайн-рендеру — нет.
    const { collectPulse } = await import("../pulse/collect");
    data = await collectPulse();
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "index.html"), renderPulse(data));
  if (!process.env.PULSE_INPUT) {
    writeFileSync(join(OUT_DIR, "pulse.json"), JSON.stringify(data, null, 2));
  }
  console.log(`Пульс собран: ${join(OUT_DIR, "index.html")}`);
}

main().catch((err) => {
  console.error("Сборка пульса прервана ошибкой", err);
  process.exit(1);
});
