import type { MacroZone } from "@radar/shared";

export function extractMacroZone(input: string): MacroZone | undefined {
  if (/тылов(ые|ых)\s+регион/i.test(input)) return "rear";
  if (/прифронтов(ые|ых)\s+регион/i.test(input)) return "front";
  if (/приграничн(ые|ых)\s+регион/i.test(input)) return "border";
  return undefined;
}
