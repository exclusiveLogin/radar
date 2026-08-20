/**
 * ---
 * layer: worker/infrastructure
 * domain: phase-lifecycle
 * purpose: Адаптирует TypeORM DataSource к application SQL port.
 * ---
 */
import type { DataSource, EntityManager } from "typeorm";
import type { OperationalSql } from "../../application/phases/operationalSql.port.js";

type TypeOrmSqlExecutor = Pick<EntityManager, "query">;

class TypeOrmTransactionSql implements OperationalSql {
  constructor(private readonly executor: TypeOrmSqlExecutor) {}

  async query<TResult extends object = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<TResult[]> {
    return this.executor.query(sql, parameters ? [...parameters] : undefined) as Promise<TResult[]>;
  }

  transaction<TResult>(run: (transaction: OperationalSql) => Promise<TResult>): Promise<TResult> {
    return run(this);
  }
}

/** Преобразует TypeORM транзакции и запросы в узкий application contract. */
export class TypeOrmOperationalSql extends TypeOrmTransactionSql {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource);
  }

  transaction<TResult>(run: (transaction: OperationalSql) => Promise<TResult>): Promise<TResult> {
    return this.dataSource.transaction((manager) => run(new TypeOrmTransactionSql(manager)));
  }
}
