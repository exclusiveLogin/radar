import { z } from "zod";

/** MTProxy transport profile — host/port/secret или env ref. */
export const mtproxyTransportSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  secret: z.string().min(1).optional(),
  envHostKey: z.string().min(1).optional(),
  envPortKey: z.string().min(1).optional(),
  envSecretKey: z.string().min(1).optional(),
});

export type MtproxyTransport = z.infer<typeof mtproxyTransportSchema>;
