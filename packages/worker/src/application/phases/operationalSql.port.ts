/**
 * ---
 * layer: worker/application
 * domain: phase-lifecycle
 * purpose: Выполняет SQL операций сброса без зависимости от ORM.
 * ---
 */

/** Узкий доступ к SQL и транзакциям для lifecycle/reset/wipe use cases. */
export interface OperationalSql {
  query<TResult extends object = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<TResult[]>;
  transaction<TResult>(run: (transaction: OperationalSql) => Promise<TResult>): Promise<TResult>;
}
