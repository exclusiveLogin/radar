import { z } from "zod";

export const severitySchema = z.enum(["info", "attention", "danger", "critical"]);

export type Severity = z.infer<typeof severitySchema>;
