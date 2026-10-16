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
 * Единый стандарт названий задач Gestión Operativa: "[Verbo en infinitivo] +
 * complemento" — точно и ясно описывает, что нужно сделать. Код объекта в
 * названии не нужен — он и так понятен по проекту, в котором создана задача.
 *
 * Если название не соответствует, Claude решает:
 *  - "fix" — суть задачи понятна из текущего названия, можно уверенно
 *    переформулировать по стандарту, ничего не домысливая сверх того, что
 *    буквально в нём есть;
 *  - "ask" — название слишком расплывчатое/двусмысленное, чтобы уверенно
 *    понять суть (например, одно слово или просто тема письма) — агент не
 *    угадывает и просит автора задачи уточнить.
 */
export async function evaluateAndFixTaskName(currentName: string): Promise<NameEvaluation> {
  return askJson(
    `Ты следишь за единым стандартом названий задач в Asana (Gestión Operativa, Prestige Expo).

Обязательный формат: "[Verbo en infinitivo] + complemento" — испанский глагол в инфинитиве (оканчивается
на -ar/-er/-ir, это настоящий глагол, а не существительное вроде "factura"), затем точное и ясное
дополнение, однозначно описывающее, что именно нужно сделать. Код объекта в названии НЕ указывается — он
и так виден из проекта, в который входит задача.

Все задачи должны называться на испанском. Название на любом другом языке (русском, английском и т.д.) —
само по себе НЕ повод спрашивать уточнение, если действие в нём понятно: такое название нужно перевести
на испанский и переформулировать по стандарту.

Правила:
1. valid=true, action="none" — если название уже на испанском и полностью соответствует формату, ясно
   описывая конкретное действие.
2. Если не соответствует, но из текущего текста МОЖНО уверенно понять, какое действие имеется в виду —
   action="fix". Переведи на испанский (если было на другом языке) и переформулируй по стандарту,
   сохранив весь смысл оригинала и ничего не добавляя от себя сверх буквально сказанного. НЕ требуй
   дополнительных деталей (конкретный клиент/объект/срок), которых не было в оригинале, если само
   действие понятно — например, "Подготовить мебельный пакет" уверенно переводится как "Preparar el
   paquete de mobiliario", без запроса, для какого именно клиента.
3. action="ask" только если само действие остаётся неясным независимо от языка — название состоит из
   одного слова/аббревиатуры/номера, или по нему в принципе нельзя понять, что нужно сделать. НЕ
   придумывай correctedName.

reason — максимально коротко (до 12 слов на русском), это пойдёт в комментарий пользователю.

Отвечай СТРОГО JSON: {"valid": true|false, "action": "none"|"fix"|"ask", "correctedName": "..." (только
при action="fix", иначе опусти поле), "reason": "..."}.`,
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

/**
 * Отвечает на упоминание агента (@Asanchez) в комментарии задачи. Только
 * текстовый ответ — агент не предпринимает действий (не переименовывает, не
 * назначает и т.д.) в рамках ответа на упоминание, только поясняет/советует
 * на основе контекста задачи.
 */
export async function answerMention(params: {
  taskName: string;
  taskNotes: string;
  recentComments: string[];
  question: string;
}): Promise<string> {
  const { taskName, taskNotes, recentComments, question } = params;
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    system: `Ты Asanchez — агент, который следит за единым стандартом задач в Asana (Gestión Operativa,
Prestige Expo). Тебя упомянули (@Asanchez) в комментарии задачи с вопросом или просьбой.

Отвечай кратко и по делу, только на испанском, опираясь только на контекст задачи ниже — ничего не
придумывай сверх того, что в нём есть. Если вопрос без контекста непонятен (например, просто "уточни" без
уточнения, что именно) — посмотри на свои предыдущие комментарии в этой задаче: скорее всего, вопрос
относится к ним. Если и так неясно — переспроси коротко, что именно нужно уточнить.

Ты НЕ выполняешь действия в рамках этого ответа (не переименовываешь, не назначаешь исполнителя и т.п.) —
только отвечаешь текстом. Если для ответа нужно действие, опиши, что ты бы сделал, и предложи подтвердить.

Отвечай только текстом ответа, без вступлений вроде "Ответ:".`,
    messages: [
      {
        role: "user",
        content:
          `Задача: "${taskName}"\nОписание: ${taskNotes || "(пусто)"}\n\n` +
          `Недавние комментарии (от старых к новым):\n${recentComments.join("\n---\n") || "(нет)"}\n\n` +
          `Вопрос в новом комментарии: "${question}"`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude не вернул ответ на упоминание");
  }
  return textBlock.text.trim();
}
