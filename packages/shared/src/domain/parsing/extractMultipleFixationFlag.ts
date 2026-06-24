/** «Множественная фиксация» — trait multiple-processor; read-side fallback по raw_text. */
export function extractMultipleFixationFlag(input: string): boolean {
  return /множественн[а-яёА-ЯЁ]*\s+фиксаци/i.test(input.trim());
}
