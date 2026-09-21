import express from "express";
import cron from "node-cron";
import { config } from "./config";
import { runWeeklyDuplicateScan } from "./engine/weeklyDuplicateScan";
import { logger } from "./logger";
import { asanaWebhookRouter } from "./webhook/asanaWebhookRouter";

const app = express();

app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "asanchez" });
});

app.use(asanaWebhookRouter);

app.listen(config.server.port, () => {
  logger.info("Asanchez запущен", { port: config.server.port });
});

cron.schedule(
  config.duplicateScan.cron,
  () => {
    runWeeklyDuplicateScan().catch((err) => {
      logger.error("Еженедельная проверка дублей завершилась с ошибкой", { err: String(err) });
    });
  },
  { timezone: config.duplicateScan.timezone },
);

logger.info("Еженедельная проверка дублей запланирована", {
  cron: config.duplicateScan.cron,
  timezone: config.duplicateScan.timezone,
});
