import * as THREE from 'three';

export interface WaveComponent {
  dx: number;
  dz: number;
  amplitude: number;
  wavelength: number;
  steepness: number;
  speed: number;
}

/**
 * 4-octave Gerstner wave spectrum synchronized verbatim between TypeScript buoyancy
 * (ships, player swimming, sea life) and the GLSL ocean surface shader.
 */
export const OCEAN_WAVE_SPECTRUM: readonly WaveComponent[] = [
  { dx: 0.86, dz: 0.51, amplitude: 0.42, wavelength: 28.0, steepness: 0.42, speed: 1.05 },
  { dx: 0.42, dz: 0.91, amplitude: 0.24, wavelength: 16.5, steepness: 0.36, speed: 1.35 },
  { dx: -0.62, dz: 0.78, amplitude: 0.14, wavelength: 9.2, steepness: 0.28, speed: 1.7 },
  { dx: 0.94, dz: -0.34, amplitude: 0.08, wavelength: 5.1, steepness: 0.22, speed: 2.15 },
];

export interface WaveSampleResult {
  height: number;
  nx: number;
  ny: number;
  nz: number;
  foamFactor: number;
}

export class OceanWaveSampler {
  public swellScale = 1.0;

  public setWeatherSwell(weather: 'Clear' | 'Rain' | 'Thunderstorm' | 'Ashfall' | 'Mist'): void {
    if (weather === 'Thunderstorm') this.swellScale = 1.95;
    else if (weather === 'Rain') this.swellScale = 1.38;
    else if (weather === 'Mist') this.swellScale = 0.72;
    else this.swellScale = 1.0;
  }

  public sampleHeight(worldX: number, worldZ: number, timeSec: number, shoreDamping = 1.0): number {
    let y = 0;
    const scale = this.swellScale * THREE.MathUtils.clamp(shoreDamping, 0.12, 1.0);
    for (let i = 0; i < OCEAN_WAVE_SPECTRUM.length; i++) {
      const w = OCEAN_WAVE_SPECTRUM[i];
      const k = (Math.PI * 2) / w.wavelength;
      const phase = k * (w.dx * worldX + w.dz * worldZ) - w.speed * timeSec;
      y += Math.sin(phase) * w.amplitude * scale;
    }
    return y;
  }

  public sampleFull(worldX: number, worldZ: number, timeSec: number, shoreDamping = 1.0): WaveSampleResult {
    let y = 0;
    let dHx = 0;
    let dHz = 0;
    let crestSum = 0;
    const scale = this.swellScale * THREE.MathUtils.clamp(shoreDamping, 0.12, 1.0);

    for (let i = 0; i < OCEAN_WAVE_SPECTRUM.length; i++) {
      const w = OCEAN_WAVE_SPECTRUM[i];
      const k = (Math.PI * 2) / w.wavelength;
      const amp = w.amplitude * scale;
      const phase = k * (w.dx * worldX + w.dz * worldZ) - w.speed * timeSec;
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      y += s * amp;
      dHx += w.dx * k * amp * c;
      dHz += w.dz * k * amp * c;
      crestSum += Math.max(0, s);
    }

    const inv = 1 / Math.hypot(-dHx, 1, -dHz);
    return {
      height: y,
      nx: -dHx * inv,
      ny: inv,
      nz: -dHz * inv,
      foamFactor: THREE.MathUtils.clamp((crestSum - 1.35) * 0.65, 0, 1),
    };
  }
}
