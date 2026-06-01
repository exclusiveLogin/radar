/** Курсор поллера history: (время, id) — не теряем пачки с одним timestamp (reset:pipeline). */
export type HistoryPollCursor = {
  at: Date;
  /** Пусто только до первой обработанной строки; иначе сравнение id > '' ломает uuid в PG. */
  id: string;
};

export function createHistoryPollCursor(from = new Date()): HistoryPollCursor {
  return { at: from, id: "" };
}

/** WHERE (at > cursor OR (at = cursor AND id > cursorId)) для ORDER BY at ASC, id ASC. */
export function historyAfterCursorSql(
  atColumn: string,
  idColumn: string,
): string {
  return `(${atColumn} > :cursorAt OR (${atColumn} = :cursorAt AND ${idColumn} > :cursorId))`;
}

/** Условие выборки: без id — только по времени (старт поллера). */
export function historyAfterCursorWhere(
  atColumn: string,
  idColumn: string,
  cursor: HistoryPollCursor,
): { clause: string; params: { cursorAt: Date; cursorId?: string } } {
  if (cursor.id) {
    return {
      clause: historyAfterCursorSql(atColumn, idColumn),
      params: { cursorAt: cursor.at, cursorId: cursor.id },
    };
  }
  return {
    clause: `${atColumn} > :cursorAt`,
    params: { cursorAt: cursor.at },
  };
}

export function advanceHistoryPollCursor(
  cursor: HistoryPollCursor,
  row: { at: Date; id: string },
): HistoryPollCursor {
  return { at: row.at, id: row.id };
}
