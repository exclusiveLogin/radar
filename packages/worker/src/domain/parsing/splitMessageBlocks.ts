export function splitMessageBlocks(input: string): string[] {
  const normalized = input.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const headerRegex = /^(?:.+?), \[\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\]$/m;
  if (headerRegex.test(normalized)) {
    const lines = normalized.split("\n");
    const blocks: string[] = [];
    let chunk: string[] = [];
    for (const line of lines) {
      if (headerRegex.test(line) && chunk.length > 0) {
        blocks.push(chunk.join("\n").trim());
        chunk = [line];
      } else {
        chunk.push(line);
      }
    }
    if (chunk.length > 0) blocks.push(chunk.join("\n").trim());
    return blocks.filter(Boolean);
  }

  return normalized
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
}
