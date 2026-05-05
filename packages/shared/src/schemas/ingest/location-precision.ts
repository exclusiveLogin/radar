import { z } from "zod";

export const locationPrecisionSchema = z.enum([
  "region",
  "district",
  "city",
  "locality",
  "settlement",
]);

export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;
