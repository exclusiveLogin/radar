/**
 * ---
 * layer: worker/composition
 * domain: bootstrap
 * purpose: Собирает persistence, transport и fallback repositories worker.
 * ---
 */
import type {
  IChannelRepository,
  IEventEvidenceRepository,
  IEventLocationRepository,
  IEventTransport,
  IIngestBackfillJobRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  IPlaceAliasRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionAdjacencyRepository,
  IRegionRepository,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import type { OperationalSql } from "../../application/phases/operationalSql.port.js";
import { ParseAttemptWriter } from "../../application/subscribers/index.js";
import { createEventTransport } from "../../infrastructure/transport/createEventTransport.js";
import { createWorkerDataSource } from "../../infrastructure/persistence/createWorkerDataSource.js";
import { TypeOrmOperationalSql } from "../../infrastructure/persistence/typeOrmOperationalSql.js";
import {
  InMemoryEventEvidenceRepository,
  InMemoryEventLocationRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryParsedEventRepository,
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRawMessageRepository,
  InMemoryRegionRepository,
} from "../../infrastructure/testing/inMemoryRepositories.js";
import { createWorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.js";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { WorkerStorageMode } from "../../infrastructure/persistence/storageMode.js";
import type { resolveWorkerBootstrapContext } from "./resolveWorkerBootstrapContext.js";

type BootstrapContext = ReturnType<typeof resolveWorkerBootstrapContext>;

/** Создаёт DB или in-memory persistence, сохраняя единый runtime contract. */
export async function createWorkerPersistence(
  context: Pick<
    BootstrapContext,
    | "storageMode"
    | "workerRole"
    | "infraManifest"
    | "needsParseStack"
    | "bus"
    | "lifecycle"
  >,
) {
  let dataSource: DataSource | undefined;
  let operationalSql: OperationalSql | undefined;
  let workerRepos: WorkerDbRepositories | undefined;
  let rawMessages: IRawMessageRepository = new InMemoryRawMessageRepository();
  let parsedEvents: IParsedEventRepository = new InMemoryParsedEventRepository();
  let messageParseWorkspaces: IMessageParseWorkspaceRepository =
    new InMemoryMessageParseWorkspaceRepository();
  let eventLocations: IEventLocationRepository = new InMemoryEventLocationRepository();
  let eventEvidence: IEventEvidenceRepository = new InMemoryEventEvidenceRepository();
  let regions: IRegionRepository = new InMemoryRegionRepository();
  // Смежность живёт только в БД: в in-memory режиме соседей нет (граф пустой).
  let regionAdjacency: IRegionAdjacencyRepository | undefined;
  let places: IPlaceRepository = new InMemoryPlaceRepository();
  let aliases: IPlaceAliasRepository = new InMemoryPlaceAliasRepository();
  let cursors: IIngestCursorRepository | undefined;
  let ingestProviders: IIngestProviderRepository | undefined;
  let ingestBindings: IIngestBindingRepository | undefined;
  let channels: IChannelRepository | undefined;
  let backfillJobs: IIngestBackfillJobRepository | undefined;
  let eventTransport: IEventTransport;

  if (context.storageMode === WorkerStorageMode.Db) {
    dataSource = await createWorkerDataSource();
    operationalSql = new TypeOrmOperationalSql(dataSource);
    eventTransport = createEventTransport({
      transport: context.infraManifest.transport,
      workerRole: context.workerRole,
      dataSource,
    });
    await eventTransport.start();
    context.lifecycle.register(async () => {
      if (dataSource?.isInitialized) await dataSource.destroy();
    });
    context.lifecycle.register(() => eventTransport.stop());

    workerRepos = await createWorkerDbRepositories(dataSource);
    ({
      rawMessages,
      parsedEvents,
      messageParseWorkspaces,
      eventLocations,
      eventEvidence,
      regions,
      regionAdjacency,
      places,
      aliases,
      cursors,
      ingestProviders,
      ingestBindings,
      channels,
      backfillJobs,
    } = workerRepos);

    if (context.needsParseStack) {
      const parseAttemptWriter = new ParseAttemptWriter(workerRepos.parseAttempts);
      context.bus.subscribe("MessageParsed", parseAttemptWriter.handler);
      context.bus.subscribe("MessageParseFailed", parseAttemptWriter.handler);
    }
  } else {
    eventTransport = createEventTransport({
      transport: context.infraManifest.transport,
      workerRole: context.workerRole,
    });
    await eventTransport.start();
  }

  return {
    dataSource,
    operationalSql,
    workerRepos,
    eventTransport,
    rawMessages,
    parsedEvents,
    messageParseWorkspaces,
    eventLocations,
    eventEvidence,
    regions,
    regionAdjacency,
    places,
    aliases,
    cursors,
    ingestProviders,
    ingestBindings,
    channels,
    backfillJobs,
    shutdown:
      context.storageMode === WorkerStorageMode.Db
        ? () => context.lifecycle.shutdown()
        : undefined,
  };
}
