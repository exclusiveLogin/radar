export function extractRepeatFlag(input: string): boolean {
  return /повторн|сохраняется/i.test(input);
}
