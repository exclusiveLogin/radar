import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoEnrichmentState,
  IEventLocationRepository,
  IParsedEventRepository,
  ParsedEvent,
} from "@radar/shared";
import { geoEnrichmentStateSchema } from "@radar/shared";

export type GeoEnrichmentStateLoadResult = {
  parsedEventId: string;
  artifact: GeoEnrichmentArtifact;
  priorLocations: EventLocation[];
  parsedEvent: ParsedEvent;
};

/** Достаёт geo snapshot из extras без validatedLocations/phaseId. */
export function artifactFromGeoState(
  state: GeoEnrichmentState | undefined,
): GeoEnrichmentArtifact {
  if (!state) {
    return {};
  }
  return {
    catalog: state.catalog,
    llm: state.llm,
    dadata: state.dadata,
    nominatim: state.nominatim,
    finalizer: state.finalizer,
  };
}

/** Парсит extras.geoArtifact с fallback на пустой объект. */
export function parseGeoEnrichmentState(
  extras: Record<string, unknown> | undefined,
): GeoEnrichmentState | undefined {
  const raw = extras?.geoArtifact;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = geoEnrichmentStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Собирает snapshot для persist после успешного parse. */
export function buildGeoEnrichmentState(input: {
  artifact: GeoEnrichmentArtifact;
  validatedLocations: EventLocation[];
  phaseId?: string;
}): GeoEnrichmentState {
  return {
    ...input.artifact,
    validatedLocations: input.validatedLocations,
    phaseId: input.phaseId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Загружает prior geo-контекст для enrich-фазы.
 * validatedLocations из snapshot приоритетнее evloc (быстрее, канон после validation).
 */
export async function loadGeoEnrichmentState(input: {
  rawMessageId: string;
  parsedEvents: IParsedEventRepository;
  eventLocations: IEventLocationRepository;
}): Promise<GeoEnrichmentStateLoadResult | null> {
  const record = await input.parsedEvents.findByRawMessageId(input.rawMessageId);
  if (!record) {
    return null;
  }

  const stored = parseGeoEnrichmentState(record.extras);
  const fromDb = await input.eventLocations.listForParsedEvent(record.id);
  const priorLocations =
    stored?.validatedLocations && stored.validatedLocations.length > 0
      ? stored.validatedLocations
      : fromDb;

  return {
    parsedEventId: record.id,
    artifact: artifactFromGeoState(stored),
    priorLocations,
    parsedEvent: record,
  };
}

/** Вливает geo snapshot в extras parsed_event. */
export function withGeoEnrichmentExtras(
  extras: Record<string, unknown>,
  state: GeoEnrichmentState,
): Record<string, unknown> {
  return {
    ...extras,
    geoArtifact: state,
  };
}
