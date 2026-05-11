/** Число объектов в формулировке поста (БПЛА, цели, сбитые) — масштаб события для отчёта. */
export function extractCounts(input: string): number | undefined {
  const patterns = [/от\s+(\d+)\s+бпла/i, /(\d+)\s+цел(?:ь|и|ей)/i, /свыше\s+(\d+)\s+сбит/i];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
}
