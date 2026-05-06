import { z } from "zod";

export const placeStatusActionSchema = z.enum(["activate", "deactivate"]);

export const placeStatusEventSchema = z.object({
  id: z.string().uuid(),
  placeId: z.string().uuid(),
  statusCode: z.string().min(1),
  action: placeStatusActionSchema,
  source: z.enum(["parser", "operator", "system"]),
  eventAt: z.string().datetime(),
  meta: z.record(z.unknown()).default({}),
});

export type PlaceStatusAction = z.infer<typeof placeStatusActionSchema>;
export type PlaceStatusEvent = z.infer<typeof placeStatusEventSchema>;
