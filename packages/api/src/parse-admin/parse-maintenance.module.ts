import { Global, Module } from "@nestjs/common";
import { ParseMaintenanceGate } from "./parse-maintenance.gate";

/** Глобальный gate: API reset ↔ map/parse read-path. */
@Global()
@Module({
  providers: [ParseMaintenanceGate],
  exports: [ParseMaintenanceGate],
})
export class ParseMaintenanceModule {}
