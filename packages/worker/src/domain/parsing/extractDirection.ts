/** Направление угрозы из текста («в направлении …», «в вашем направлении») для карты/сводки. */
export function extractDirection(input: string): string | undefined {
  const specific = input.match(/в\s+направлении\s+([^\n.]+)/i);
  if (specific?.[1]) return specific[1].trim();
  if (/в\s+вашем\s+направлении/i.test(input)) return "в вашем направлении";
  return undefined;
}
