/**
 * Признак массовости события (trait mass), ортогонален event_type.
 * Массированные пуски, волна, «летит много», группа БПЛА.
 */
export function extractMassFlag(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  return (
    /массирован\w*\s+(?:пуск|атак|прол[её]т)/i.test(text)
    || /массов[а-яё]*\s+прол[её]т/i.test(text)
    || /летит\s+много|много\s+(?:бпла|дрон)/i.test(text)
    || /волн[еа].*бпла/i.test(text)
    || /ещ[её]\s+летят/i.test(text)
    || /групп[а-яё]*\s+бпла/i.test(text)
    || /от\s*[2-9]\d*\s*бпла/i.test(text)
    || /тылов\w*\s+регион.*(?:прол[её]т|пуск|бпла)/is.test(text)
    || /много|массирован/i.test(text)
  );
}
