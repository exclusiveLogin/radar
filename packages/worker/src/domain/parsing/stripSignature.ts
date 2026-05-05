const FOOTER_PATTERNS = [
  /^❗️Радар/i,
  /^🌐\s*Обход/i,
  /^🔵\s*Подписаться/i,
  /^📲\s*Мы в MAX/i,
  /^https?:\/\//i,
];

export function stripSignature(input: string): string {
  const rows = input
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x !== "");

  const filtered = rows.filter(
    (line) => !FOOTER_PATTERNS.some((regex) => regex.test(line)),
  );
  return filtered.join("\n").trim();
}
