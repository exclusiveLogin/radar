import { Global, Module } from "@nestjs/common";
import { TrackingL1ResetGate } from "./tracking-l1-reset.gate";

/** Общие провайдеры tracking read/write coordination для map + tracking-admin. */
@Global()
@Module({
  providers: [TrackingL1ResetGate],
  exports: [TrackingL1ResetGate],
})
export class TrackingInfraModule {}
