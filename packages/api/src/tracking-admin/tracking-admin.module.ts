import { Module } from "@nestjs/common";
import { TrackingInfraModule } from "../tracking/tracking-infra.module";
import {
  ControlTrackingRunUseCase,
  PatchTrackingConfigUseCase,
  SetTrackingEnabledUseCase,
  StartTrackingRebuildUseCase,
} from "../application/tracking-admin/tracking-admin-commands";
import { TrackingAdminController } from "./tracking-admin.controller";
import { TrackingAdminQueryService } from "./tracking-admin.service";

@Module({
  imports: [TrackingInfraModule],
  controllers: [TrackingAdminController],
  providers: [
    TrackingAdminQueryService,
    {
      provide: PatchTrackingConfigUseCase,
      useFactory: (port: TrackingAdminQueryService) => new PatchTrackingConfigUseCase(port),
      inject: [TrackingAdminQueryService],
    },
    {
      provide: SetTrackingEnabledUseCase,
      useFactory: (port: TrackingAdminQueryService) => new SetTrackingEnabledUseCase(port),
      inject: [TrackingAdminQueryService],
    },
    {
      provide: StartTrackingRebuildUseCase,
      useFactory: (port: TrackingAdminQueryService) => new StartTrackingRebuildUseCase(port),
      inject: [TrackingAdminQueryService],
    },
    {
      provide: ControlTrackingRunUseCase,
      useFactory: (port: TrackingAdminQueryService) => new ControlTrackingRunUseCase(port),
      inject: [TrackingAdminQueryService],
    },
  ],
  exports: [TrackingAdminQueryService, SetTrackingEnabledUseCase],
})
export class TrackingAdminModule {}
