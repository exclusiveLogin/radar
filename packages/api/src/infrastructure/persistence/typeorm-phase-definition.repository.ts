import type {
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  PhaseKind,
  PhaseManifestEntry,
} from "@radar/shared";
import type { DataSource } from "typeorm";

type PhaseRow = {
  id: string;
  kind: PhaseKind;
  stage: PhaseDefinitionRecord["stage"] | null;
  enrichers: PhaseManifestEntry["enrichers"];
  enabled: boolean;
  order_index: number;
  updated_at: Date;
};

/** Реестр фаз обогащения на Postgres. Upsert идемпотентен по `id`. */
export class TypeOrmPhaseDefinitionRepository implements IPhaseDefinitionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listAll(): Promise<PhaseDefinitionRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, kind, stage, enrichers, enabled, order_index, updated_at
       FROM phase_definitions ORDER BY kind, order_index`,
    )) as PhaseRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async listEnabled(kind?: PhaseKind): Promise<PhaseDefinitionRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, kind, stage, enrichers, enabled, order_index, updated_at
       FROM phase_definitions
       WHERE enabled = true AND ($1::text IS NULL OR kind = $1)
       ORDER BY order_index`,
      [kind ?? null],
    )) as PhaseRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async upsert(entry: PhaseManifestEntry): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO phase_definitions (id, kind, stage, enrichers, enabled, order_index, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         stage = EXCLUDED.stage,
         enrichers = EXCLUDED.enrichers,
         order_index = EXCLUDED.order_index,
         updated_at = now()`,
      [
        entry.id,
        entry.kind,
        entry.stage ?? null,
        JSON.stringify(entry.enrichers),
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

  private toRecord(row: PhaseRow): PhaseDefinitionRecord {
    return {
      id: row.id,
      kind: row.kind,
      stage: row.stage ?? undefined,
      enrichers: row.enrichers,
      enabled: row.enabled,
      order: row.order_index,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
