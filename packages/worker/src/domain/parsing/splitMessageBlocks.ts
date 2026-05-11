const TELEGRAM_EXPORT_HEADER_REGEX =
  /^(?:.+?), \[\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\]$/m;

/** Делит экспорт Telegram на отдельные сообщения по шаблонной строке заголовка. */
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

/** Режет произвольный текст на блоки по двойным переводам строки. */
function splitByEmptyLines(normalizedInput: string): string[] {
  return normalizedInput
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Один вход: либо экспорт с заголовками сообщений, либо простой текст — выбирается стратегия сплита. */
export function splitMessageBlocks(input: string): string[] {
  const normalized = input.replace(/\r/g, "").trim();
  if (!normalized) return [];

  if (TELEGRAM_EXPORT_HEADER_REGEX.test(normalized)) {
    return splitByHeaders(normalized);
  }

  return splitByEmptyLines(normalized);
}
