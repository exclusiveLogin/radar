import { z } from "zod";

export const macroZoneSchema = z.enum(["rear", "front", "border"]);

export type MacroZone = z.infer<typeof macroZoneSchema>;
