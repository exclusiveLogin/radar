/**
 * Маркер неподтверждённого сигнала в тексте канала («возможно», «вероятно»).
 * SSOT для uncertain-processor и read-side fallback по raw_text.
 *
 * \b в JS не ставит границы на кириллице — явные разделители, без «возможность».
 */
const UNCERTAIN_PHRASE =
  /(?:^|[\s,.:;—\-–()])(?:возможно|вероятно)(?:[\s,.:;—\-–()]|$)/iu;

export function extractUncertainFlag(input: string): boolean {
  return UNCERTAIN_PHRASE.test(input.trim());
}
