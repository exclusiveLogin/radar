/**
 * @see ../../../../../docs/database-table-naming.md
 * Операционный реестр фаз (ADR-003 v2). Манифест → import; админка — enabled/policy.
 */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "phase_definitions" })
export class PhaseDefinitionEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id!: string;

  @Column({ name: "trigger", type: "text" })
  trigger!: string;

  @Column({ name: "scope", type: "text", default: "ingestParse" })
  scope!: string;

  @Column({ name: "kind", type: "text", nullable: true })
  kind!: string | null;

  @Column({ name: "stage", type: "text", nullable: true })
  stage!: string | null;

  @Column({ name: "enrichers", type: "jsonb", default: () => "'[]'::jsonb" })
  enrichers!: string[];

  @Column({ name: "policy", type: "jsonb", default: () => "'{}'::jsonb" })
  policy!: Record<string, unknown>;

  @Column({ name: "enabled", type: "boolean", default: true })
  enabled!: boolean;

  @Column({ name: "order_index", type: "integer", default: 0 })
  orderIndex!: number;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
