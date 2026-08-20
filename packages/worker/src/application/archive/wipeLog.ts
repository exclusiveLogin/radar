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
      "cancel log_parse_phase_run + очистка ingest/geo очередей",
      "TRUNCATE work_parse_message, mat_parse_event CASCADE → mat_parse_location, mat_parse_evidence, …",
      "TRUNCATE log_parse_attempt, job_geo_place_enrich, log_parse_phase_run",
      "TRUNCATE job_ingest_backfill, state_ingest_cursor, event_outbox",
      "TRUNCATE mat_ingest_raw CASCADE",
    ]);
    this.phase("geo-places", 2, 3, [
      "cancel geo jobs",
      "UPDATE regions.canonical_place_id → NULL",
      "UPDATE mat_parse_location.place_id → NULL",
      "TRUNCATE job_geo_place_enrich, mat_parse_evidence, place_aliases, places CASCADE",
    ]);
    this.phase("geo-catalog", 3, 3, [
      "unlink FK на regions / places / mat_parse_location",
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
