/**
 * Операционный реестр фаз обогащения (ADR-003). Авторинг — в коде-манифесте
 * (`docs/examples/phase.manifest.default.json` → `phase:manifest:import`),
 * админка только переключает `enabled`. Eager-подписчик и lazy-планировщик
 * читают включённые фазы из этой таблицы, а не из хардкода.
 */
import { Column, Entity, PrimaryColumn } from "typeorm";

type PhaseKind = "eager" | "lazy";
type EnrichStage = "llm" | "dadata" | "nominatim";

@Entity({ name: "phase_definitions" })
export class PhaseDefinitionEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id!: string;

  @Column({ name: "kind", type: "text" })
  kind!: PhaseKind;

  @Column({ name: "stage", type: "text", nullable: true })
  stage!: EnrichStage | null;

  @Column({ name: "enrichers", type: "jsonb", default: () => "'[]'::jsonb" })
  enrichers!: string[];

  @Column({ name: "enabled", type: "boolean", default: true })
  enabled!: boolean;

  @Column({ name: "order_index", type: "integer", default: 0 })
  orderIndex!: number;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
