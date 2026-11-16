/**
 * Deterministic fixed-timestep simulation accumulator with clamped deltas
 * and smooth exponential frame-time averaging for adaptive GPU tiering.
 */
export class FixedStepLoop {
  private accumulator = 0;
  private lastNow = 0;
  private smoothedFrameMs = 16.6;
  public readonly fixedDt: number;
  private readonly maxFrameDt = 0.05;
  private readonly resumeThresholdMs = 1000;
  private readonly maxStepsPerFrame = 4;

  constructor(fixedHz = 60) {
    this.fixedDt = 1 / fixedHz;
  }

  public reset(nowMs = performance.now()): void {
    this.lastNow = nowMs;
    this.accumulator = 0;
    this.smoothedFrameMs = 16.6;
  }

  public step(
    nowMs: number,
    onFixedStep: (fixedDt: number) => void,
    onRender: (frameDt: number, alpha: number, smoothedFrameMs: number) => void
  ): void {
    if (this.lastNow === 0) this.lastNow = nowMs;
    const rawMs = Math.max(0, nowMs - this.lastNow);
    this.lastNow = nowMs;
    // A tab suspension is not gameplay time. Do not simulate stale movement
    // or trigger the adaptive-quality downgrade on the first resumed frame.
    if (rawMs >= this.resumeThresholdMs) {
      this.accumulator = 0;
      onRender(0, 1, this.smoothedFrameMs);
      return;
    }
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + Math.min(100, Math.max(0.5, rawMs)) * 0.1;

    const frameDt = Math.min(this.maxFrameDt, rawMs / 1000);
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
      onFixedStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxStepsPerFrame && this.accumulator > this.fixedDt) {
      // Drop spiral-of-death backlog safely
      this.accumulator %= this.fixedDt;
    }

    const alpha = Math.max(0, Math.min(1, this.accumulator / this.fixedDt));
    onRender(frameDt, alpha, this.smoothedFrameMs);
  }

  public getSmoothedFrameMs(): number {
    return this.smoothedFrameMs;
  }
}
