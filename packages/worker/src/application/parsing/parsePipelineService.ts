import type {
  EventLocation,
  GeoPipelineReport,
  IEventClassifier,
  ParseReport,
  ParsedEvent,
} from "@radar/shared";
import { createHash } from "node:crypto";
import type { LocationResolutionService } from "./locationResolutionService.js";
import {
  buildEventReport,
  buildNonEventReport,
} from "./parseReportBuilders.js";

export type ParsePipelineResult = {
  report: ParseReport;
  parsedEvent?: ParsedEvent;
  locations: EventLocation[];
  geoPipeline?: GeoPipelineReport;
};

export type ParsePipelineInput = {
  rawText: string;
  postedAt?: string;
  channelKey?: string;
  rawMessageId?: string;
  file?: string;
  index?: number;
};

export class ParsePipelineService {
  constructor(
    private readonly classifier: IEventClassifier,
    private readonly resolution: LocationResolutionService,
  ) {}

  async execute(input: ParsePipelineInput): Promise<ParsePipelineResult> {
    const classified = this.classifier.classify(input.rawText);
    const hash = createHash("sha256").update(input.rawText, "utf8").digest("hex");
    const inputMeta = { ...input, hash };

    if (classified.kind !== "event") {
      const report = buildNonEventReport({
        input: inputMeta,
        kind: classified.kind,
        reason: classified.reason,
      });
      return { report, locations: [], geoPipeline: undefined };
    }

    const parsedEvent: ParsedEvent = {
      ...classified.event,
      rawMessageId: input.rawMessageId ?? classified.event.rawMessageId,
      postedAt: input.postedAt ?? classified.event.postedAt,
    };

    const resolved = await this.resolution.resolve(input.rawText);
    return {
      report: buildEventReport({
        input: inputMeta,
        parsedEvent,
        resolved,
      }),
      parsedEvent,
      locations: resolved.locations,
      geoPipeline: resolved.geoPipeline,
    };
  }
}
