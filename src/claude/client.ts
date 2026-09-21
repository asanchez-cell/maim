import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Не удалось найти JSON в ответе Claude: ${text}`);
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function askJson<T>(system: string, user: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude не вернул текстовый ответ");
  }
  return extractJson(textBlock.text) as T;
}

/**
 * Проверяет, что текст после кода/дефиса — это испанский глагол в инфинитиве
 * с дополнением (раздел 1: "[Verbo en infinitivo] + complemento").
 */
export async function verifyVerbInfinitiveComplement(
  textAfterDash: string,
): Promise<{ ok: boolean; reason: string }> {
  return askJson(
    `Ты проверяешь названия задач Prestige Expo на соответствие формату:
"[Verbo en infinitivo] + complemento" (испанский глагол в инфинитиве + дополнение).
Отвечай СТРОГО JSON без пояснений вне JSON: {"ok": true|false, "reason": "краткое объяснение на русском"}.
ok=true только если первое слово — реальный испанский глагол в инфинитиве (оканчивается на -ar/-er/-ir и
является настоящим глаголом, а не существительным вроде "factura" или "actas"), и после него идёт
осмысленное дополнение (не пустое, не просто существительное само по себе).`,
    `Текст для проверки: "${textAfterDash}"`,
  );
}

/**
 * Классифицирует полное название задачи: соответствует ли оно одному из
 * известных форматов, если это не удалось определить регулярными выражениями.
 */
export async function classifyAmbiguousTaskName(
  name: string,
  knownCodes: string[],
): Promise<{ ok: boolean; reason: string }> {
  return askJson(
    `Ты проверяешь названия задач Asana компании Prestige Expo. Допустимые форматы:
1) "[KOD] — [Verbo en infinitivo] + complemento" — KOD один из: ${knownCodes.join(", ")}
2) "YYMMDD | YYMM_CODIGO | EMPRESA | Tipo" где Tipo один из: Weekly Management, Design Coordination,
   Construction, Technical, Commercial, Internal, Other — это протокол встречи (Acta de Reunión)
3) "[Categoria] — [действие]" — подзадача-соглашение протокола встречи
Отвечай СТРОГО JSON: {"ok": true|false, "reason": "краткое объяснение на русском"}.
ok=false, если название — это просто существительное без глагола-действия, тема письма, или не имеет
чёткой структуры "код/дата — действие".`,
    `Название задачи: "${name}"`,
  );
}

/**
 * Переводит текст между испанским и русским для двуязычного описания задачи.
 */
export async function translateText(text: string, targetLang: "es" | "ru"): Promise<string> {
  const targetName = targetLang === "ru" ? "русский" : "испанский";
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    system: `Ты переводишь описания рабочих задач компании Prestige Expo между испанским и русским.
Переводи точно и по-деловому, сохраняй форматирование (переносы строк, списки). Верни ТОЛЬКО перевод,
без вступлений, без кавычек, без пояснений.`,
    messages: [{ role: "user", content: `Переведи на ${targetName}:\n\n${text}` }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude не вернул перевод");
  }
  return textBlock.text.trim();
}

/**
 * Определяет, на каком языке (ES/RU/оба/ни один) написан текст.
 */
export async function detectLanguages(
  text: string,
): Promise<{ hasEs: boolean; hasRu: boolean }> {
  return askJson(
    `Определи, присутствует ли в тексте содержательный текст на испанском и/или на русском языке.
Отвечай СТРОГО JSON: {"hasEs": true|false, "hasRu": true|false}.
Пустой или заглушка-плейсхолдер в квадратных скобках не считается содержательным текстом.`,
    `Текст:\n\n${text || "(пусто)"}`,
  );
}

/**
 * Смысловая оценка пары задач-кандидатов на дубль: общий объект/подрядчик/контекст.
 */
export async function judgeDuplicatePair(
  taskA: { name: string; notes: string },
  taskB: { name: string; notes: string },
): Promise<{ likelyDuplicate: boolean; reason: string }> {
  return askJson(
    `Ты помогаешь найти дублирующиеся задачи в Asana. Даны две задачи одного проекта.
Оцени, описывают ли они одну и ту же работу (дубль), или разные задачи, которые просто похожи по словам
(например, две разные заявки на подключение электричества для разных объектов — НЕ дубль).
Отвечай СТРОГО JSON: {"likelyDuplicate": true|false, "reason": "краткое объяснение на русском"}.`,
    `Задача A: "${taskA.name}"\nОписание A: ${taskA.notes || "(пусто)"}\n\n` +
      `Задача B: "${taskB.name}"\nОписание B: ${taskB.notes || "(пусто)"}`,
  );
}
