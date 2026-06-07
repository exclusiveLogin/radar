import type { PvoStats } from "@radar/shared";
import type { RegionCatalog } from "../../infrastructure/geo-catalog/regionCatalog.js";

// Суффикс кириллических слов (JS-regex: \w не матчит кириллицу).
const CYR = "[а-яёА-ЯЁ]*";
// Необязательное слово-квантификатор между числом и типом цели: «единицы», «штук», «объектов».
const UNIT = `(?:[а-яёА-ЯЁ]+\\s+)?`;

/** Паттерны для извлечения периода отчёта. */
const PERIOD_PATTERNS = [
  // «С 1 по 5 мая»
  /[сС]\s+\d{1,2}\s+по\s+\d{1,2}\s+[а-яёА-ЯЁ]+/i,
  // «С 14:00 до 20:00»
  /[сС]\s+\d{1,2}[:.]\d{2}\s+до\s+\d{1,2}[:.]\d{2}/,
  // «За прошедшую ночь [и утро]»
  /[зЗ]а\s+прошедш[а-яёА-ЯЁ]+\s+[а-яёА-ЯЁ]+(?:\s+и\s+[а-яёА-ЯЁ]+)?/i,
  // «В течение прошедшей ночи»
  /[вВ]\s+течение\s+прошедш[а-яёА-ЯЁ]+\s+[а-яёА-ЯЁ]+/i,
  // «В период с ...»
  /[вВ]\s+период\s+с\s+.+?(?=\sбыло|\sсилами|\sуничтожено|$)/is,
  // «За период с ...»
  /[зЗ]а\s+период\s+с.+?(?=\sбыло|\sсилами|\sуничтожено|$)/is,
];

/** Счётчик БПЛА (итоговый или уничтоженных) в тексте. */
const DRONE_COUNT = new RegExp(
  `(?:уничтожен${CYR}|перехвачен${CYR}\\s+и\\s+уничтожен${CYR})\\s+(\\d+)\\s+${UNIT}(?:бпла|беспилотн)`,
  "i",
);

/** Счётчик ракет/крылатых ракет. */
const ROCKET_COUNT = new RegExp(
  `(?:уничтожен${CYR}|перехвачен${CYR})\\s+(\\d+)\\s+${UNIT}(?:крылат${CYR}\\s+)?ракет`,
  "i",
);

/** Счётчик МВШ (малоразмерных воздушных шаров). */
const BALLOON_COUNT = new RegExp(
  `(?:уничтожен${CYR}|перехвачен${CYR})\\s+(\\d+)\\s+${UNIT}мвш`,
  "i",
);

/** Паттерны для счётчика цели внутри одного предложения (шаблон Б). */
const SENTENCE_DRONE = new RegExp(
  `(?:уничтожен${CYR}|перехвачен${CYR})\\s+(\\d+)\\s+${UNIT}(?:бпла|беспилотн)`,
  "i",
);
const SENTENCE_ROCKET = new RegExp(
  `(?:уничтожен${CYR}|перехвачен${CYR})\\s+(\\d+)\\s+${UNIT}(?:крылат${CYR}\\s+)?ракет`,
  "i",
);
const SENTENCE_BALLOON = new RegExp(
  `(?:уничтожен${CYR}|перехвачен${CYR})\\s+(\\d+)\\s+${UNIT}мвш`,
  "i",
);

function matchPeriod(input: string): string | undefined {
  for (const pattern of PERIOD_PATTERNS) {
    const match = pattern.exec(input);
    if (match) return match[0].trim().slice(0, 60);
  }
  return undefined;
}

/**
 * Извлекает счётчики по отдельным регионам (шаблон Б):
 * предложения вида «над Ленинградской областью уничтожено 59 БПЛА».
 * Обрабатывает только предложения, в которых ровно один регион.
 */
function extractByRegion(
  input: string,
  regionCatalog: RegionCatalog,
): NonNullable<PvoStats["byRegion"]> {
  const sentences = input.split(/[.!\n]+/).map((s) => s.trim()).filter(Boolean);
  const result: NonNullable<PvoStats["byRegion"]> = [];

  for (const sentence of sentences) {
    const regions = regionCatalog.findRegionsInText(sentence);
    if (regions.length !== 1) continue;

    const droneMatch   = SENTENCE_DRONE.exec(sentence);
    const rocketMatch  = SENTENCE_ROCKET.exec(sentence);
    const balloonMatch = SENTENCE_BALLOON.exec(sentence);

    const drones   = droneMatch   ? Number(droneMatch[1])   : undefined;
    const rockets  = rocketMatch  ? Number(rocketMatch[1])  : undefined;
    const balloons = balloonMatch ? Number(balloonMatch[1]) : undefined;

    if (drones === undefined && rockets === undefined && balloons === undefined) continue;

    result.push({ code: regions[0]!.code, name: regions[0]!.name, drones, rockets, balloons });
  }

  return result;
}

/**
 * Разбирает текст сводки ПВО на структурированные данные.
 *
 * @param input         Сырой текст сообщения с type=pvo_report.
 * @param regionCatalog Каталог регионов для резолвинга прилагательных форм → ISO-код.
 */
export function extractPvoStats(input: string, regionCatalog: RegionCatalog): PvoStats {
  const period = matchPeriod(input);

  const dronesMatch   = DRONE_COUNT.exec(input);
  const rocketsMatch  = ROCKET_COUNT.exec(input);
  const balloonsMatch = BALLOON_COUNT.exec(input);

  const drones   = dronesMatch   ? Number(dronesMatch[1])   : undefined;
  const rockets  = rocketsMatch  ? Number(rocketsMatch[1])  : undefined;
  const balloons = balloonsMatch ? Number(balloonsMatch[1]) : undefined;

  const resolved = regionCatalog.findRegionsInText(input);
  const regions  = resolved.map((r) => ({ code: r.code, name: r.name }));

  const byRegion = extractByRegion(input, regionCatalog);

  return {
    period,
    totals: { drones, rockets, balloons },
    regions,
    byRegion: byRegion.length > 0 ? byRegion : undefined,
  };
}
