import { z } from "zod";

/** Ответ GET /api/health — общий контракт API ↔ web ↔ клиенты. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
  service: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Успешный ответ GET /api/ready. */
export const readyResponseSchema = z.object({
  status: z.literal("ready"),
  database: z.literal(true),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;
