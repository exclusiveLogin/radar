/** Подробные логи system:wipe и других wipe-операций. */
export class WipeLogger {
  constructor(private readonly verbose: boolean) {}

  /** Основная строка. */
  line(message: string): void {
    console.log(`[system:wipe] ${message}`);
  }

  /** Детали шага — всегда видны при wipe. */
  detail(message: string): void {
    console.log(`[system:wipe]       ${message}`);
  }

  /** SQL / низкоуровневые детали — только с --verbose. */
  sql(message: string): void {
    if (this.verbose) {
      this.detail(`sql: ${message}`);
    }
  }

  /** Заголовок фазы со списком действий. */
  phase(phase: string, index: number, total: number, actions: string[]): void {
    this.line(`━━━ [${index}/${total}] фаза ${phase} ━━━`);
    for (const action of actions) {
      this.detail(action);
    }
  }

  /** План полного wipe перед стартом. */
  printFullPlan(): void {
    this.line("═══════════════════════════════════════════════════════");
    this.line("ПЛАН system:wipe (TRUNCATE CASCADE, порядок по FK)");
    this.line("═══════════════════════════════════════════════════════");
    this.phase("ingest-parse", 1, 3, [
      "cancel phase_runs + очистка ingest/geo очередей",
      "TRUNCATE place_status_read_model, region_status_read_model",
      "TRUNCATE parsed_events CASCADE → event_locations, event_evidence, …",
      "TRUNCATE parse_attempts, place_enrichment_jobs, phase_runs",
      "TRUNCATE ingest_backfill_jobs, ingest_cursors, domain_events",
      "TRUNCATE raw_messages CASCADE",
    ]);
    this.phase("geo-places", 2, 3, [
      "cancel geo jobs",
      "UPDATE regions.canonical_place_id → NULL",
      "UPDATE event_locations.place_id → NULL",
      "TRUNCATE place_enrichment_jobs, event_evidence, place_aliases, places CASCADE",
    ]);
    this.phase("geo-catalog", 3, 3, [
      "unlink FK на regions / places / event_locations",
      "TRUNCATE region_adjacency, region_state_*, place_geo_link",
      "TRUNCATE geo_feature, place_aliases, places, geo_dataset_file, regions CASCADE",
    ]);
    this.line("───────────────────────────────────────────────────────");
    if (this.verbose) {
      this.detail("режим --verbose: полный SQL в лог");
    } else {
      this.detail("подробности шагов в лог; SQL: добавьте --verbose");
    }
    this.line("═══════════════════════════════════════════════════════");
  }
}

export function createWipeLogger(verbose = false): WipeLogger {
  return new WipeLogger(verbose);
}
