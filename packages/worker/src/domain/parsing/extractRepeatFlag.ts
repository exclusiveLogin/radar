export function extractRepeatFlag(input: string): boolean {
  return /\bповторно\b|сохраняется/i.test(input);
}
