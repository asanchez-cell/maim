/**
 * Одноразовый скрипт регистрации вебхуков Asana для всех проектов из
 * config/projectCodes.json (с заполненным asanaProjectGid).
 *
 * Перед запуском:
 *   1. Сервис должен быть запущен и доступен по PUBLIC_BASE_URL (Asana
 *      делает handshake-запрос на этот адрес сразу при создании вебхука).
 *   2. npm run register-webhooks
 */
import { asana } from "../asana/client";
import { config } from "../config";
import { logger } from "../logger";
import { trackedProjects } from "../projectCodes";

async function main(): Promise<void> {
  if (!config.server.publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL не задан в .env — вебхук Asana некуда будет доставлять");
  }

  const target = `${config.server.publicBaseUrl.replace(/\/$/, "")}/webhooks/asana`;
  const workspaceGid = await asana.getWorkspaceGid();
  const existing = await asana.listWebhooks(workspaceGid);

  const projects = trackedProjects();
  if (projects.length === 0) {
    logger.warn(
      "В config/projectCodes.json ни у одного проекта не заполнен asanaProjectGid — нечего регистрировать",
    );
    return;
  }

  for (const project of projects) {
    const already = existing.find(
      (w) => w.resource.gid === project.asanaProjectGid && w.target === target,
    );
    if (already) {
      logger.info("Вебхук уже зарегистрирован — пропуск", { code: project.code });
      continue;
    }

    try {
      await asana.createWebhook(project.asanaProjectGid, target);
      logger.info("Вебхук зарегистрирован", { code: project.code, target });
    } catch (err) {
      logger.error("Не удалось зарегистрировать вебхук", { code: project.code, err: String(err) });
    }
  }
}

main()
  .then(() => {
    logger.info("Регистрация вебхуков завершена");
    process.exit(0);
  })
  .catch((err) => {
    logger.error("Регистрация вебхуков прервана ошибкой", { err: String(err) });
    process.exit(1);
  });
