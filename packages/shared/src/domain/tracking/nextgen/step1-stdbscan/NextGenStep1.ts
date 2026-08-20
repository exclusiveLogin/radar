/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/nextgen
 * purpose: Фаза 1 — ST-DBSCAN. Схлопывание дублей и расчет базовой гравитационной массы (Reliability -> Mass).
 * ---
 */
import { stdbscanMagnetize, type ClusterParams, type MagnetizeWeights } from "../../stdbscan/stdbscanMagnetize";
import type { TrackingCandidate } from "../../types";

export interface NextGenNode extends TrackingCandidate {
  /**
   * Нейтральная базовая масса узла = 1 (одно событие = одна единица).
   * Гравитация НЕ свойство точки: она эмерджентна из консенсуса H3-поля
   * (busyness × согласованность коридора), считается в Фазе 3/4.
   */
  mass: number;
}

export class NextGenStep1 {
  /**
   * Запускает ST-DBSCAN для удаления дублей и превращает оставшихся кандидатов в атомарные ноды.
   */
  public static execute(
    candidates: TrackingCandidate[],
    params: ClusterParams,
    weights?: MagnetizeWeights
  ): NextGenNode[] {
    // Используем существующий алгоритм схлопывания дублей 
    // (stdbscanMagnetize внутри себя фильтрует дубликаты если collapse=true, 
    // либо помечает магнитами. В NextGen мы всегда схлопываем абсолютные дубли).
    const result = stdbscanMagnetize(candidates, params, weights);

    // Выжившие кандидаты → атомарные ноды. Масса нейтральна (1 событие = 1 единица);
    // гравитация рождается позже из H3-консенсуса, а не из плотности кластера дедупа.
    return result.candidates.map((c) => ({ ...c, mass: 1.0 }));
  }
}
