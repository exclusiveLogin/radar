import type {
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  PhaseManifestEntry,
  PhasePolicy,
  PhaseScope,
  PhaseTriggerMode,
} from "@radar/shared";
import { DEFAULT_PHASE_POLICY, phasePolicySchema, phaseTriggerModeSchema } from "@radar/shared";
import type { DataSource } from "typeorm";

type PhaseRow = {
  id: string;
  trigger_mode: string;
  scope: PhaseScope;
  enrichers: PhaseManifestEntry["enrichers"];
  policy: Record<string, unknown>;
  enabled: boolean;
  order_index: number;
  updated_at: Date;
};

/** Реестр фаз обогащения на Postgres (trigger_mode SSOT). */
export class TypeOrmPhaseDefinitionRepository implements IPhaseDefinitionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listAll(): Promise<PhaseDefinitionRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, trigger_mode, scope, enrichers, policy, enabled, order_index, updated_at
       FROM phase_definitions ORDER BY order_index`,
    )) as PhaseRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async listEnabled(
    triggerMode?: PhaseTriggerMode,
    scope?: PhaseScope,
  ): Promise<PhaseDefinitionRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, trigger_mode, scope, enrichers, policy, enabled, order_index, updated_at
       FROM phase_definitions
       WHERE enabled = true
         AND ($1::text IS NULL OR trigger_mode = $1)
         AND ($2::text IS NULL OR scope = $2)
       ORDER BY order_index`,
      [triggerMode ?? null, scope ?? null],
    )) as PhaseRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async findById(id: string): Promise<PhaseDefinitionRecord | null> {
    const rows = (await this.dataSource.query(
      `SELECT id, trigger_mode, scope, enrichers, policy, enabled, order_index, updated_at
       FROM phase_definitions WHERE id = $1`,
      [id],
    )) as PhaseRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async upsert(entry: PhaseManifestEntry): Promise<void> {
    // legacy columns kind/stage — NOT NULL в старой схеме до отдельной миграции drop
    const legacyKind = entry.triggerMode === "event" ? "eager" : "lazy";
    const legacyStage =
      entry.triggerMode === "timeout" || entry.triggerMode === "both" ? entry.id : null;

    await this.dataSource.query(
      `INSERT INTO phase_definitions (id, kind, stage, trigger_mode, scope, enrichers, policy, enabled, order_index, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         stage = EXCLUDED.stage,
         trigger_mode = EXCLUDED.trigger_mode,
         scope = EXCLUDED.scope,
         enrichers = EXCLUDED.enrichers,
         policy = EXCLUDED.policy,
         enabled = EXCLUDED.enabled,
         order_index = EXCLUDED.order_index,
         updated_at = now()`,
      [
        entry.id,
        legacyKind,
        legacyStage,
        entry.triggerMode,
        entry.scope,
        JSON.stringify(entry.enrichers),
        JSON.stringify(entry.policy),
        entry.enabled,
        entry.order,
      ],
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_definitions SET enabled = $2, updated_at = now() WHERE id = $1`,
      [id, enabled],
    );
  }

  async updatePolicy(id: string, policy: Partial<PhasePolicy>): Promise<void> {
    const current = await this.findById(id);
    if (!current) return;
    const merged = phasePolicySchema.parse({ ...current.policy, ...policy });
    await this.dataSource.query(
      `UPDATE phase_definitions SET policy = $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(merged)],
    );
  }

  private toRecord(row: PhaseRow): PhaseDefinitionRecord {
    return {
      id: row.id,
      triggerMode: phaseTriggerModeSchema.parse(row.trigger_mode),
      scope: row.scope ?? "ingestParse",
      enrichers: row.enrichers,
      policy: phasePolicySchema.parse({ ...DEFAULT_PHASE_POLICY, ...row.policy }),
      enabled: row.enabled,
      order: row.order_index,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
