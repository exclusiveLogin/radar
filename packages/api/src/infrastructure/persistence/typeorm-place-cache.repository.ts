import type { IPlaceCacheRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceCacheEntity } from "../../events/entities";

export class TypeOrmPlaceCacheRepository implements IPlaceCacheRepository {
  constructor(private readonly dataSource: DataSource) {}

  async get(
    queryNorm: string,
    provider?: "dadata" | "nominatim" | "llm",
  ): Promise<
    | {
        provider: "dadata" | "nominatim" | "llm";
        raw: Record<string, unknown>;
        fetchedAt?: string;
        validatedAt?: string;
        confidence?: number;
      }
    | null
  > {
    const row = await this.dataSource.getRepository(PlaceCacheEntity).findOne(
      provider
        ? { where: { queryNorm, provider } }
        : { where: { queryNorm }, order: { fetchedAt: "DESC" } },
    );
    if (!row) {
      return null;
    }
    return {
      provider: row.provider,
      raw: row.raw,
      fetchedAt: row.fetchedAt.toISOString(),
      validatedAt: row.validatedAt?.toISOString(),
      confidence: row.confidence ? Number(row.confidence) : undefined,
    };
  }

  async put(
    queryNorm: string,
    provider: "dadata" | "nominatim" | "llm",
    value: Record<string, unknown>,
    meta?: {
      confidence?: number;
      validator?: "rule" | "human" | "provider";
      expiresAt?: string;
      validatedAt?: string;
    },
  ): Promise<void> {
    const repo = this.dataSource.getRepository(PlaceCacheEntity);
    const existing = await repo.findOne({ where: { queryNorm, provider } });
    if (existing) {
      existing.raw = value;
      existing.fetchedAt = new Date();
      existing.confidence =
        meta?.confidence !== undefined ? meta.confidence.toFixed(3) : null;
      existing.validator = meta?.validator ?? null;
      existing.expiresAt = meta?.expiresAt ? new Date(meta.expiresAt) : null;
      existing.validatedAt = meta?.validatedAt
        ? new Date(meta.validatedAt)
        : null;
      await repo.save(existing);
      return;
    }
    await repo.save(
      repo.create({
        queryNorm,
        provider,
        raw: value,
        confidence:
          meta?.confidence !== undefined ? meta.confidence.toFixed(3) : null,
        validator: meta?.validator ?? null,
        expiresAt: meta?.expiresAt ? new Date(meta.expiresAt) : null,
        validatedAt: meta?.validatedAt ? new Date(meta.validatedAt) : null,
      }),
    );
  }
}
