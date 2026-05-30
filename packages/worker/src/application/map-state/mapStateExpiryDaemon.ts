import type { MapStateExpirySweep } from "./mapStateExpirySweep.js";

/**
 * Периодический TTL-sweep статусов карты (регионы и places).
 */
export class MapStateExpiryDaemon {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sweep: MapStateExpirySweep,
    private readonly pollMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.sweep.run();
      if (result.regionsExpired > 0 || result.placesExpired > 0) {
        console.log(
          `MapStateExpiry: regions=${result.regionsExpired} places=${result.placesExpired}`,
        );
      }
    } catch (error) {
      console.error("MapStateExpiry: sweep failed", error);
    }
  }
}
