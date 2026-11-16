declare module 'n8ao' {
  import type * as THREE from 'three';
  import type { Pass } from 'postprocessing';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: THREE.Color;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    gammaCorrection: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    biasOffset: number;
    biasMultiplier: number;
  }

  export class N8AOPostPass extends Pass {
    configuration: N8AOConfiguration;
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}
