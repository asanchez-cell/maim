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

export interface NameEvaluation {
  valid: boolean;
  action: "none" | "fix" | "ask";
  correctedName?: string;
  reason: string;
}

/**
 * Единый стандарт названий задач Gestión Operativa: "[KOD] — [Verbo en
 * infinitivo] + complemento" — точно и ясно описывает, что нужно сделать.
 *
 * Если название не соответствует, Claude решает:
 *  - "fix" — суть задачи понятна из текущего названия, можно уверенно
 *    переформулировать по стандарту, ничего не домысливая сверх того, что
 *    буквально в нём есть;
 *  - "ask" — название слишком расплывчатое/двусмысленное, чтобы уверенно
 *    понять суть (например, одно слово или просто тема письма) — агент не
 *    угадывает и просит автора задачи уточнить.
 */
export async function evaluateAndFixTaskName(currentName: string, code: string): Promise<NameEvaluation> {
  return askJson(
    `Ты следишь за единым стандартом названий задач в проекте Asana "Gestión Operativa" компании
Prestige Expo (код этого проекта: "${code}").

Обязательный формат: "${code} — [Verbo en infinitivo] + complemento" — испанский глагол в инфинитиве
(оканчивается на -ar/-er/-ir, это настоящий глагол, а не существительное вроде "factura"), затем точное
и ясное дополнение, однозначно описывающее, что именно нужно сделать.

Правила:
1. valid=true, action="none" — если название уже полностью соответствует формату и ясно описывает
   конкретное действие.
2. Если не соответствует, но из текущего текста МОЖНО уверенно понять, что имелось в виду (например,
   "Factura electricidad Viña Chica" явно означает обработку/оплату счёта за электричество этого
   объекта) — action="fix", предложи correctedName в правильном формате "${code} — ...", сохранив весь
   смысл оригинала и ничего не добавляя от себя сверх буквально сказанного.
3. Если название слишком расплывчатое, состоит из одного слова/аббревиатуры/номера, или по нему нельзя
   уверенно понять суть задачи — action="ask", НЕ придумывай correctedName, объясни в reason, что именно
   неясно.

Отвечай СТРОГО JSON: {"valid": true|false, "action": "none"|"fix"|"ask", "correctedName": "..." (только
при action="fix", иначе опусти поле), "reason": "кратко на русском"}.`,
    `Текущее название задачи: "${currentName}"`,
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
