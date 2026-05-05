import { z } from "zod";

export const eventTypeSchema = z.enum([
  "fixation",
  "attention",
  "danger",
  "pvo_work",
  "impact",
  "cleared",
  "safety_measures",
  "rocket_threat",
  "airspace_restriction",
  "mass_warning",
]);

export type EventType = z.infer<typeof eventTypeSchema>;
