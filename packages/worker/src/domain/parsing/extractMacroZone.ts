import type { MacroZone } from "@radar/shared";

/** Крупная зона (тыл / прифронт / приграничье) из формулировки — для агрегации и фильтров. */
export function extractMacroZone(input: string): MacroZone | undefined {
  if (/тылов(ые|ых)\s+регион/i.test(input)) return "rear";
  if (/прифронтов(ые|ых)\s+регион/i.test(input)) return "front";
  if (/приграничн(ые|ых)\s+регион/i.test(input)) return "border";
  return undefined;
}
