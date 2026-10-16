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

async function askJson<T>(system: string, user: string, maxTokens = 512): Promise<T> {
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
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

export interface TaskAssignmentHints {
  /**
   * Имя, явно названное человеком (например "Laura") — агент не угадывает, кто это: резолвится кодом
   * через реальный справочник пользователей Asana, назначается только при однозначном совпадении.
   */
  assigneeName?: string;
  /** Срок, явно указанный человеком, в днях от сегодня (например "через неделю" → 7). */
  dueInDays?: number;
}

export interface MentionResolution {
  kind: "reply" | "fix" | "split";
  /** Всегда есть — текст ответа/объяснения, публикуется как комментарий. */
  reply: string;
  // kind === "fix"
  newName?: string;
  newNotes?: string;
  fixAssignment?: TaskAssignmentHints;
  // kind === "split": текущая задача сужается до первой части, вторая(ые) — новые задачи того же проекта.
  keepName?: string;
  keepNotes?: string;
  keepAssignment?: TaskAssignmentHints;
  newTasks?: ({ name: string; notes?: string } & TaskAssignmentHints)[];
}

/**
 * Обрабатывает упоминание агента (@Asanchez) в комментарии задачи. Может не
 * только ответить текстом, но и выполнить явно и однозначно запрошенное
 * действие — поправить название/описание (kind="fix") или разделить задачу
 * на две (kind="split") — но только когда из контекста (включая собственные
 * прошлые комментарии агента) понятно, что именно делать; при любой
 * неоднозначности — kind="reply" с уточняющим вопросом, без действия.
 *
 * Вне зоны ответственности агента остаются закрытие/удаление задач,
 * назначение исполнителя и срока — даже если об этом попросят в упоминании,
 * это делает человек.
 */
export async function resolveMention(params: {
  taskName: string;
  taskNotes: string;
  recentComments: string[];
  question: string;
}): Promise<MentionResolution> {
  const { taskName, taskNotes, recentComments, question } = params;
  return askJson(
    `Ты Asanchez — агент, который следит за единым стандартом задач в Asana (Gestión Operativa, Prestige
Expo: названия на испанском в формате "[Verbo infinitivo] + complemento"). Тебя упомянули (@Asanchez) в
комментарии задачи с вопросом или просьбой.

Варианты:
1. kind="reply" — просто ответить текстом. Используй, когда это вопрос, или когда для действия не хватает
   однозначной ясности.
2. kind="fix" — поправить название и/или описание ЭТОЙ задачи. Используй, только если прямо просят что-то
   поправить (например "поправь сам", "исправь название") И из контекста (включая твои прошлые комментарии
   в этой задаче) однозначно понятно, что именно исправить. newName должен соответствовать стандарту.
3. kind="split" — разделить задачу на две. Используй, только если прямо просят разделить/декомпозировать И
   из контекста понятно, на какие именно две части (например, ты сам раньше отмечал, что в названии два
   разных результата). keepName/keepNotes — суженная версия текущей задачи (первая часть); newTasks —
   новая(ые) задача(и) на вторую часть, названия по стандарту.

Если не хватает однозначной уверенности в деталях — НЕ действуй, используй kind="reply" с уточняющим
вопросом. Ничего не придумывай сверх того, что есть в контексте.

Исполнитель и срок — если человек явно называет, кому назначить (по имени) и/или когда срок, для fix —
fixAssignment, для split — keepAssignment (первая часть) и assigneeName/dueInDays внутри каждого элемента
newTasks (вторая часть и далее). assigneeName — ровно то имя, как назвал человек (ты не проверяешь, что
это реальный пользователь — это сделает код отдельно, назначит только при однозначном совпадении).
dueInDays — число дней от сегодня (целое), если был явный относительный срок ("через неделю" → 7, "завтра"
→ 1, "до пятницы" — посчитай дни до ближайшей пятницы); если срок не называли — не указывай это поле.
Если имя/срок не названы явно — не выдумывай, оставь поле пустым (человек донастроит вручную).

Ты НЕ можешь закрывать/удалять задачи — если просят об этом, kind="reply" с объяснением, что это делает
человек.

reply — всегда короткий текст на испанском: ответ на вопрос, или объяснение, что сделано (для fix/split),
или что именно нужно уточнить. Не утверждай, что исполнитель/срок уже назначены — это добавится отдельной
строкой после твоего ответа, если резолвится однозначно. Описания (newNotes/keepNotes/notes в newTasks) —
1-2 коротких предложения, без лишних деталей.

Отвечай СТРОГО JSON: {"kind": "reply"|"fix"|"split", "reply": "...", "newName"?: "...", "newNotes"?: "...",
"fixAssignment"?: {"assigneeName"?: "...", "dueInDays"?: 0}, "keepName"?: "...", "keepNotes"?: "...",
"keepAssignment"?: {"assigneeName"?: "...", "dueInDays"?: 0},
"newTasks"?: [{"name": "...", "notes"?: "...", "assigneeName"?: "...", "dueInDays"?: 0}]}`,
    `Задача: "${taskName}"\nОписание: ${taskNotes || "(пусто)"}\n\n` +
      `Недавние комментарии (от старых к новым):\n${recentComments.join("\n---\n") || "(нет)"}\n\n` +
      `Новый комментарий с упоминанием: "${question}"`,
    // Ответ может включать reply + названия/описания для fix/split (вплоть до нескольких новых задач) —
    // 512 токенов по умолчанию не хватает и обрезает JSON на середине.
    1536,
  );
}
