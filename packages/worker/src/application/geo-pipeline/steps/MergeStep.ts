import type { EventLocation } from "@radar/shared";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";
import { buildFinalizerResult } from "./finalizerMerge.js";

/**
 * Терминальный шаг фазы (ADR-003): сводит namespace энричеров фазы в накопитель
 * по правилам trust/precision. Гео-специализация делегируется `buildFinalizerResult`
 * (дедупликация regions/places + приоритет координат); пофайльный merge атрибутов
 * события использует общий `mergeContribution` (SSOT).
 *
 * Приоритет координат по порядку merge: catalog → llm → dadata → nominatim.
 *
 * Историческое имя namespace/трейса — `finalizer` (сохранено для совместимости
 * со схемой артефакта и персистом).
 */
export class MergeStep implements GeoPipelineStep {
  readonly id = "finalizer";

  constructor(private readonly locations: EventLocation[]) {}

  run(ctx: GeoPipelineContext): Promise<void> {
    const { finalizer, locations } = buildFinalizerResult(
      ctx.artifact,
      ctx.rawText,
    );
    ctx.artifact.finalizer = finalizer;
    this.locations.push(...locations);

    return Promise.resolve();
  }
}
