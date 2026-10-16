import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request } from "express";
import { config } from "../config";
import { processTask } from "../engine/processTask";
import { logger } from "../logger";

const SECRET_FILE = path.join(process.cwd(), ".webhook-secret");

interface AsanaWebhookEvent {
  action: string;
  resource: { gid: string; resource_type: string; resource_subtype?: string };
}

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

function readPersistedSecret(): string {
  try {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function persistSecret(secret: string): void {
  try {
    fs.writeFileSync(SECRET_FILE, secret, "utf8");
  } catch (err) {
    logger.warn("Не удалось сохранить секрет вебхука на диск", { err: String(err) });
  }
}

let webhookSecret = config.asana.webhookSecret || readPersistedSecret();

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!webhookSecret || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const asanaWebhookRouter = Router();

asanaWebhookRouter.post("/webhooks/asana", (req: RequestWithRawBody, res) => {
  // Handshake: первый запрос Asana при регистрации вебхука приносит X-Hook-Secret,
  // который дальше используется для подписи всех последующих доставок.
  const hookSecretHeader = req.header("X-Hook-Secret");
  if (hookSecretHeader) {
    webhookSecret = hookSecretHeader;
    persistSecret(hookSecretHeader);
    logger.info("Handshake вебхука Asana выполнен, секрет сохранён в .webhook-secret");
    res.setHeader("X-Hook-Secret", hookSecretHeader);
    res.status(200).end();
    return;
  }

  const signature = req.header("X-Hook-Signature");
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  if (!verifySignature(rawBody, signature)) {
    logger.warn("Некорректная подпись вебхука Asana — запрос отклонён");
    res.status(401).end();
    return;
  }

  // Asana ожидает ответ в течение ~10 секунд — отвечаем сразу,
  // обработка событий идёт асинхронно.
  res.status(200).end();

  // Только "added" — реагируем на появление новой задачи в проекте, не на
  // правки старых (см. src/scripts/pollProjects.ts).
  const events: AsanaWebhookEvent[] = req.body?.events ?? [];
  for (const event of events) {
    if (event.resource?.resource_type !== "task") continue;
    if (event.action !== "added") continue;

    processTask(event.resource.gid).catch((err) => {
      logger.error("Ошибка обработки задачи из вебхука", {
        taskGid: event.resource.gid,
        err: String(err),
      });
    });
  }
});
