import type { IPlaceCacheRepository } from "@radar/shared";
import * as fs from "node:fs";
import * as path from "node:path";

type CacheRecord = {
  queryNorm: string;
  provider: "dadata" | "nominatim" | "llm";
  raw: Record<string, unknown>;
  fetchedAt: string;
  validatedAt?: string;
  confidence?: number;
};

type CacheStore = {
  records: CacheRecord[];
};

export class JsonPlaceCacheRepository implements IPlaceCacheRepository {
  constructor(private readonly filePath: string) {}
private readStore(): CacheStore {
    if (!fs.existsSync(this.filePath)) {
      return { records: [] };
    }
    const source = fs.readFileSync(this.filePath, "utf8");
    if (!source.trim()) {
      return { records: [] };
    }
    return JSON.parse(source) as CacheStore;
  }
private writeStore(store: CacheStore): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf8");
  }
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
    const store = this.readStore();
    const normalized = queryNorm.toLowerCase().trim();

    if (provider) {
      const row = store.records.find(
        (item) => item.queryNorm === normalized && item.provider === provider,
      );
      if (!row) return null;
      return {
        provider: row.provider,
        raw: row.raw,
        fetchedAt: row.fetchedAt,
        validatedAt: row.validatedAt,
        confidence: row.confidence,
      };
    }

    const row = store.records
      .filter((item) => item.queryNorm === normalized)
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
    if (!row) return null;

    return {
      provider: row.provider,
      raw: row.raw,
      fetchedAt: row.fetchedAt,
      validatedAt: row.validatedAt,
      confidence: row.confidence,
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
    const store = this.readStore();
    const normalized = queryNorm.toLowerCase().trim();

    const nextRecord: CacheRecord = {
      queryNorm: normalized,
      provider,
      raw: value,
      fetchedAt: new Date().toISOString(),
      validatedAt: meta?.validatedAt,
      confidence: meta?.confidence,
    };

    const index = store.records.findIndex(
      (row) => row.queryNorm === normalized && row.provider === provider,
    );

    if (index >= 0) {
      store.records[index] = nextRecord;
    } else {
      store.records.push(nextRecord);
    }

    this.writeStore(store);
  }
}
export function resolveJsonPlaceCachePath(customPath?: string): string {
  if (customPath) {
    return path.isAbsolute(customPath)
      ? customPath
      : path.resolve(process.cwd(), customPath);
  }

  const candidates = [
    path.resolve(process.cwd(), "data/parser-cache/places.json"),
    path.resolve(process.cwd(), "../../data/parser-cache/places.json"),
    path.resolve(process.cwd(), "../../../data/parser-cache/places.json"),
  ];

  return candidates[0];
}
