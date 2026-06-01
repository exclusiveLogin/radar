/**
 * Флаг «идёт CLI-прогресс» — подписчики не должны писать в stdout (ломает cli-progress).
 */
let active = false;

export function setCliProgressActive(value: boolean): void {
  active = value;
}

export function isCliProgressActive(): boolean {
  return active && Boolean(process.stdout.isTTY);
}
