/**
 * SSOT: каноническое имя НП для alias/stem/name match (parse, OSM link, catalog).
 * Срезает канальные и муниципальные приписки до топонима из FIAS.
 */

/** Внутренний stem без повторной нормализации label (см. placeStem.ts). */
export function placeStemCore(name: string): string {
  if (!name) return "";

  const STOP_WORDS = [
    "район",
    "муниципальный район",
    "городской округ",
    "муниципальный округ",
    "область",
    "республика",
    "автономный округ",
    "автономная область",
    "край",
    "округ",
    "город",
    "посёлок",
    "поселок",
    "деревня",
    "село",
    "станица",
    "хутор",
    "р-н",
    "г",
    "обл",
    "респ",
    "ао",
    "мо",
  ];

  const CHAR_REPLACEMENTS: Array<[RegExp, string]> = [
    [/ё/g, "е"],
    [/-/g, ""],
    [/[^а-яa-z0-9\s]/gi, " "],
    [/\s+/g, " "],
  ];

  let value = name.toLowerCase().trim();
  // Длинные stop-words первыми («муниципальный район» до «район»)
  const stopWords = [...STOP_WORDS].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (const stopWord of stopWords) {
      const normalized = stopWord.replace(/ё/g, "е");
      const before = value;
      value = value
        .replace(new RegExp(`^${normalized}\\s+`, "gi"), "")
        .replace(new RegExp(`\\s+${normalized}$`, "gi"), "");
      if (value !== before) changed = true;
    }
  }
  for (const [pattern, replacement] of CHAR_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value.trim();
}

/**
 * Топоним без приписок «ГО», «городской округ …», «… городской округ».
 * Не трогает emoji/«и близлежащие» — это слой channelCityListPromo.
 */
export function normalizePlaceMatchLabel(name: string): string {
  let label = name.replace(/\r/g, "").split("\n")[0]!.trim();
  label = label.replace(/^направлении\s+/i, "");
  label = label.replace(/^(?:го|мр|г\.?\s*о\.?)\s+/i, "");

  const leadingOkrug = label.match(
    /^(?:городской|муниципальный)\s+округ\s+(.+)$/iu,
  );
  if (leadingOkrug) {
    label = leadingOkrug[1]!.trim();
  }

  const trailingOkrug = label.match(
    /^(.+?)\s+(?:городской|муниципальный)\s+округ\s*$/iu,
  );
  if (trailingOkrug) {
    label = trailingOkrug[1]!.trim();
  }

  return label.trim();
}

/**
 * Кандидаты name_stem для lookup: основной + эвристика «Наро-фоминский» → «Наро-Фоминск».
 * Суффикс района/МО снимается до adjective-эвристики («Северский район» → «северск»).
 */
export function collectPlaceMatchStems(name: string): string[] {
  const label = normalizePlaceMatchLabel(name);
  const stems = new Set<string>();

  const primary = placeStemCore(label);
  if (primary) {
    stems.add(primary);
  }

  const coreForAdjective = label.replace(/\s+(?:мо|го|район|р-н)\s*$/iu, "").trim();
  const adjective = coreForAdjective.match(/^(.+?)(?:ский|ской)$/iu);
  if (adjective) {
    const cityLike = `${adjective[1]!}ск`;
    const alt = placeStemCore(cityLike);
    if (alt) {
      stems.add(alt);
    }
  }

  return [...stems];
}
