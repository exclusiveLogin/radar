const TELEGRAM_EXPORT_HEADER_REGEX =
  /^(?:.+?), \[\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\]$/m;

function splitByHeaders(normalizedInput: string): string[] {
  const lines = normalizedInput.split("\n");
  const blocks: string[] = [];
  let chunk: string[] = [];

  for (const line of lines) {
    if (TELEGRAM_EXPORT_HEADER_REGEX.test(line) && chunk.length > 0) {
      blocks.push(chunk.join("\n").trim());
      chunk = [line];
      continue;
    }
    chunk.push(line);
  }

  if (chunk.length > 0) {
    blocks.push(chunk.join("\n").trim());
  }
  return blocks.filter(Boolean);
}

function splitByEmptyLines(normalizedInput: string): string[] {
  return normalizedInput
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function splitMessageBlocks(input: string): string[] {
  const normalized = input.replace(/\r/g, "").trim();
  if (!normalized) return [];

  if (TELEGRAM_EXPORT_HEADER_REGEX.test(normalized)) {
    return splitByHeaders(normalized);
  }

  return splitByEmptyLines(normalized);
}
