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
  private readonly maxStepsPerFrame = 4;

  constructor(fixedHz = 60) {
    this.fixedDt = 1 / fixedHz;
  }

  public reset(nowMs = performance.now()): void {
    this.lastNow = nowMs;
    this.accumulator = 0;
  }

  public step(
    nowMs: number,
    onFixedStep: (fixedDt: number) => void,
    onRender: (frameDt: number, alpha: number, smoothedFrameMs: number) => void
  ): void {
    if (this.lastNow === 0) this.lastNow = nowMs;
    const rawMs = Math.max(0.5, nowMs - this.lastNow);
    this.lastNow = nowMs;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + Math.min(rawMs, 100) * 0.1;

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
      this.accumulator = 0;
    }

    const alpha = Math.max(0, Math.min(1, this.accumulator / this.fixedDt));
    onRender(frameDt, alpha, this.smoothedFrameMs);
  }

  public getSmoothedFrameMs(): number {
    return this.smoothedFrameMs;
  }
}
