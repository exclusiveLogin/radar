import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "channels" })
export class ChannelEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "key", type: "text", unique: true })
  key!: string;

  @Column({ name: "telegram_target", type: "text" })
  telegramTarget!: string;

  @Column({ name: "title", type: "text", nullable: true })
  title!: string | null;

  @Column({ name: "enabled", type: "boolean", default: true })
  enabled!: boolean;

  @Column({ name: "parse_overrides", type: "jsonb", default: () => "'{}'::jsonb" })
  parseOverrides!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
