/**
 * ---
 * layer: shared/transport
 * purpose: Leaf-схема routing key (без циклов schema ↔ topicCatalog ↔ phase).
 * ---
 */
import { z } from "zod";

/** Routing key / топик шины: radar.<domain>.<action>[.<sub>] */
export const radarRoutingKeySchema = z
  .string()
  .min(1)
  .regex(/^radar\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/i, "routing key must match radar.<domain>.<action>");
