import { z } from "zod";

export const locationPrecisionSchema = z.enum([
  "region",
  "district",
  "city",
  "locality",
  "settlement",
  "vicinity",
]);

export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;
