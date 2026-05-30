import type { StateLevel } from "../schemas/geo/state-level";
import { STATE_LEVEL_RANK } from "../schemas/geo/state-level";

/** Максимальный уровень тревоги по набору status_code. */
export function maxStateLevel(
  codes: Iterable<string>,
  levelByStatus: Map<string, StateLevel>,
): StateLevel {
  let best: StateLevel = "grey";
  let rank = STATE_LEVEL_RANK.grey;
  for (const code of codes) {
    const level = levelByStatus.get(code) ?? "grey";
    const nextRank = STATE_LEVEL_RANK[level];
    if (nextRank > rank) {
      rank = nextRank;
      best = level;
    }
  }
  return best;
}
