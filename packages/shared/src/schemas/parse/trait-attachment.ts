/**
 * AttachRule — кому клеить trait в workspace (P2).
 */
import { z } from "zod";

export const attachRuleSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all_candidates") }),
  z.object({
    scope: z.literal("by_kind"),
    kind: z.enum(["place", "region", "system"]),
  }),
  z.object({
    scope: z.literal("by_event_type"),
    type: z.string().min(1),
  }),
  z.object({
    scope: z.literal("by_span_overlap"),
    span: z.object({ start: z.number(), end: z.number() }),
  }),
  z.object({
    scope: z.literal("by_candidate_ids"),
    ids: z.array(z.string()).min(1),
  }),
  z.object({ scope: z.enum(["first", "last"]) }),
  z.object({ scope: z.literal("system") }),
]);

export type AttachRule = z.infer<typeof attachRuleSchema>;
