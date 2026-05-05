import type { ParsedEvent } from "../schemas/ingest/parsed-event";

export type ClassifiedPost =
  | { kind: "event"; event: ParsedEvent }
  | { kind: "noise"; reason: string }
  | { kind: "meta"; reason: string };

export interface IEventClassifier {
  classify(rawPost: string): ClassifiedPost;
}
