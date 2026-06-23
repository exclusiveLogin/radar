/**
 * Топонимы-омонимы служебных слов: не матчить по phrase без regionScope.
 * «Старый Оскол или район» → не locality «Или» (RU-IRK).
 */
export const GEO_PHRASE_STOPWORDS = new Set([
  "или",
  "наша",
  "наш",
  "меры",
  "мера",
  "это",
  "все",
  "вся",
  "они",
  "она",
  "оно",
]);

export function isGeoPhraseStopword(phraseLower: string): boolean {
  return GEO_PHRASE_STOPWORDS.has(phraseLower);
}
