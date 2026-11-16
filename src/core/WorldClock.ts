import { TimeOfDay } from '../types/game';

/**
 * Engine-owned simulation clock so day/night progression updates smoothly at 60fps
 * without forcing full terrain chunk rebuilds in React state.
 */
export class WorldClock {
  public timeOfDayIndex = 0.85; // 0..1 (0.25 dawn, 0.5 noon, 0.75 dusk, 0.9 midnight)
  public elapsedPlaySeconds = 0;
  private readonly dayCycleRate = 0.0018; // ~9.2 min full day-night cycle

  public step(dt: number, isPlaying: boolean): void {
    if (!isPlaying) return;
    this.elapsedPlaySeconds += dt;
    this.timeOfDayIndex = (this.timeOfDayIndex + dt * this.dayCycleRate) % 1;
  }

  public getTimeOfDayLabel(): TimeOfDay {
    const t = this.timeOfDayIndex;
    if (t >= 0.2 && t < 0.34) return 'Dawn';
    if (t >= 0.34 && t < 0.68) return 'Day';
    if (t >= 0.68 && t < 0.82) return 'Dusk';
    return 'Night';
  }
}
