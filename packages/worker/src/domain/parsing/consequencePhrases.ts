import type { EventType } from "@radar/shared";

/**
 * SSOT фраз-последствий / безопасности парса ПВО.
 *
 * Это слова-омонимы топонимов, которые на самом деле описывают ПОСЛЕДСТВИЕ
 * отработки ПВО (обломки сбитых целей) или совет по безопасности — не географию.
 * Один владелец на двух потребителей, чтобы не плодить параллельные слои:
 *
 *  1) `extractEventType` — берёт из фразы сигнал типа события
 *     (напр. «осколки» → `pvo_work`), используя ТЕ ЖЕ regex (`CONSEQUENCE_TYPE_RULES`);
 *  2) гео-вход (`geoProcessor`) — спаны срезаются из текста ДО гео-скана
 *     (`stripConsequencePhrases`), чтобы омоним «осколки» → д. Осколки (RU-KIR)
 *     не породил ложный НП.
 *
 * Defense-in-depth: одиночное «осколки» намеренно ОСТАЁТСЯ в `GEO_PHRASE_STOPWORDS`,
 * т.к. у того списка есть ВТОРОЙ потребитель — валидация имени НП на write-path
 * (`channelCityListPromo.isGarbageIngestPlaceName`), который этот модуль не покрывает.
 * Поэтому это не дубль с одним смыслом, а два разных скоупа.
 */
export interface ConsequencePhrase {
  /** Исходник regex без флагов: компилируется отдельно под .test и под strip. */
  readonly source: string;
  /** Сигнал типа события или `null`, если фраза только срезается (без типа). */
  readonly eventType: EventType | null;
}

/** Реестр фраз-последствий (Open/Closed: новая фраза — новая запись). */
export const CONSEQUENCE_PHRASES: readonly ConsequencePhrase[] = [
  // «осколки» / «(не попадите) под осколки» — обломки сбитых целей ⇒ ПВО отработала.
  {
    source: "(?:не\\s+попад[а-яё]*\\s+под\\s+)?осколо?к[а-яё]*",
    eventType: "pvo_work",
  },
];

/** Скомпилированные пары: matcher (без g) для типа, strip (g) для маскировки. */
const COMPILED = CONSEQUENCE_PHRASES.map((phrase) => ({
  matcher: new RegExp(phrase.source, "iu"),
  strip: new RegExp(phrase.source, "giu"),
  eventType: phrase.eventType,
}));

/**
 * Правила типа из фраз-последствий для встраивания в `extractEventType`.
 * Single-source: тот же regex, что и для strip. Порядок (приоритет) задаёт потребитель.
 */
export const CONSEQUENCE_TYPE_RULES: ReadonlyArray<{ regex: RegExp; type: EventType }> =
  COMPILED.flatMap((c) => (c.eventType ? [{ regex: c.matcher, type: c.eventType }] : []));

/**
 * Маскирует спаны фраз-последствий пробелами равной длины (offsets сохраняются,
 * длина строки не меняется), чтобы гео-скан не цеплял омонимы топонимов.
 */
export function stripConsequencePhrases(text: string): string {
  return COMPILED.reduce(
    (acc, c) => acc.replace(c.strip, (match) => " ".repeat(match.length)),
    text,
  );
}
