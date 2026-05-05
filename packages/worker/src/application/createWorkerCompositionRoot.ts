import { InProcessEventBus } from "@radar/shared";
import { ParseAttemptLogger, MetricsAggregator } from "./subscribers/index.js";
import { IngestRawMessageHandler } from "./handlers/ingestRawMessageHandler.js";
import { ParseRawMessageHandler } from "./handlers/parseRawMessageHandler.js";
import {
  InMemoryEventLocationRepository,
  InMemoryParsedEventRepository,
  InMemoryRawMessageRepository,
} from "./handlers/inMemoryRepositories.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";

export function createWorkerCompositionRoot() {
  const bus = new InProcessEventBus();
  const parseAttemptLogger = new ParseAttemptLogger();
  const metricsAggregator = new MetricsAggregator();

  bus.subscribe("MessageParsed", parseAttemptLogger.handler);
  bus.subscribe("MessageParseFailed", parseAttemptLogger.handler);
  bus.subscribe("*", metricsAggregator.handler);

  const rawMessages = new InMemoryRawMessageRepository();
  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
  const classifier = new RuleBasedEventClassifier();

  const ingestRawMessageHandler = new IngestRawMessageHandler(rawMessages, bus);
  const parseRawMessageHandler = new ParseRawMessageHandler(
    classifier,
    parsedEvents,
    eventLocations,
    bus,
  );

  return {
    bus,
    metricsAggregator,
    ingestRawMessageHandler,
    parseRawMessageHandler,
  };
}
