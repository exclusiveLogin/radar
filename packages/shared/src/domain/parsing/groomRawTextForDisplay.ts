/** Маркеры promo/footer канала — обрезаем хвост для UI (карта, панели). */
const DISPLAY_FOOTER_PATTERNS: RegExp[] = [
  /❗️\s*Радар/i,
  /🌐\s*Обход/i,
  /🔵\s*Подписаться/i,
  /📲\s*Мы в MAX/i,
  /📲\s*Канал\s+тревог/i,
  /⏰\s*Последнее\s+обновление/i,
  /https?:\/\//i,
  /@[\w_]+/i,
  /t\.me\//i,
  /подписывайтесь/i,
  /меры\s+безопасности/i,
  /промокод/i,
];

/**
 * Убирает рекламный хвост канала из raw — для tooltip/панелей без полного parse-groom.
 * SSOT read-side: API map endpoints, лента изменений.
 */
export function groomRawTextForDisplay(raw: string): string {
  let earliest = raw.length;
  for (const pattern of DISPLAY_FOOTER_PATTERNS) {
    const match = pattern.exec(raw);
    if (match && match.index < earliest) {
      earliest = match.index;
    }
  }
  if (earliest >= raw.length) return raw.trim();
  return raw.slice(0, earliest).trim();
}
