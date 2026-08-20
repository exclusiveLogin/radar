/**
 * SSOT: канальный (system-wide) отбой в тексте RVK и аналогов.
 * Исключения — только через «кроме» (см. massClearExcludeProcessor).
 */

/**
 * Отбой без перечня субъектов: «по всем …» или отсылка к «ранее объявленн…».
 * Стем `объявлен` покрывает и опечатки вроде «объявленых».
 */
export function isChannelWideMassClearText(text: string): boolean {
  if (!text.trim()) return false;
  if (!/отбой/is.test(text)) return false;
  return /(?:по\s+(?:всем|всех)|(?:^|\s)всем\s+ранее\s+объявлен|ранее\s+объявлен)/is.test(
    text,
  );
}

/** Фрагмент текста после «кроме» — перечень исключённых субъектов. */
export function extractMassClearExcludeSegment(text: string): string | null {
  const match = text.match(/(?:^|\s)кроме\s+(.+)/is);
  if (!match?.[1]) return null;
  const tail = match[1].trim();
  return tail.length > 0 ? tail : null;
}

export type MassClearWorkspaceState = {
  scope: "channel";
  excludedRegionCodes: string[];
};

export const MASS_CLEAR_CHANNEL_EXTRAS_KEY = "massClearChannel";
export const MASS_CLEAR_EXCLUDED_CODES_EXTRAS_KEY = "excludedRegionCodes";
