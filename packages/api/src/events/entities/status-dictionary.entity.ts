import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "status_dictionary" })
export class StatusDictionaryEntity {
  @PrimaryColumn({ name: "code", type: "text" })
  code!: string;

  @Column({ name: "title", type: "text" })
  title!: string;

  @Column({ name: "include_on_map", type: "boolean", default: true })
  includeOnMap!: boolean;

  @Column({ name: "parser_hints", type: "text", array: true, default: () => "ARRAY[]::text[]" })
  parserHints!: string[];

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "priority", type: "integer", default: 100 })
  priority!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
