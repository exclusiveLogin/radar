/** Признак «повторяется / сохраняется» — ситуация не разовая, важно для приоритизации. */
export function extractRepeatFlag(input: string): boolean {
  return /повторн|сохраняется/i.test(input);
}
