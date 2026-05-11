import type {
  IStatusDictionaryRepository,
  StatusDictionaryRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { StatusDictionaryEntity } from "../../events/entities";

export class TypeOrmStatusDictionaryRepository
  implements IStatusDictionaryRepository
{
  constructor(private readonly dataSource: DataSource) {}async listActive(): Promise<StatusDictionaryRecord[]> {
    const rows = await this.dataSource.getRepository(StatusDictionaryEntity).find({
      where: { isActive: true },
      order: { priority: "ASC", code: "ASC" },
    });
    return rows.map((row) => ({
      code: row.code,
      title: row.title,
      includeOnMap: row.includeOnMap,
      parserHints: row.parserHints,
      isActive: row.isActive,
    }));
  }async findByCode(code: string): Promise<StatusDictionaryRecord | null> {
    const row = await this.dataSource
      .getRepository(StatusDictionaryEntity)
      .findOne({ where: { code } });
    if (!row) {
      return null;
    }
    return {
      code: row.code,
      title: row.title,
      includeOnMap: row.includeOnMap,
      parserHints: row.parserHints,
      isActive: row.isActive,
    };
  }
}
