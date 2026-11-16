import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { GraphicsTierConfig } from '../engine/graphicsPresets';

/**
 * Post-processing & tone mapping pipeline (AgX + Selective HDR Bloom + N8AO + SMAA)
 * calibrated for rich night snow contrast and silky-smooth frame pacing.
 */
export class RenderPipeline {
  private composer: EffectComposer | null = null;
  private n8aoPass: N8AOPostPass | null = null;

  public rebuild(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    tier: GraphicsTierConfig,
    isSoftwareGl: boolean
  ): void {
    this.dispose();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatioMax));
    const w = renderer.domElement.clientWidth || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;

    if (isSoftwareGl || (tier.tier === 'low' && !tier.bloomEnabled)) {
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.toneMappingExposure = 1.25;
      return;
    }

    renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    composer.addPass(new RenderPass(scene, camera));

    if (tier.aoMode !== 'off') {
      const n8ao = new N8AOPostPass(scene, camera, w, h);
      n8ao.configuration.aoRadius = 1.65;
      n8ao.configuration.distanceFalloff = 1.2;
      n8ao.configuration.intensity = 1.15;
      n8ao.configuration.color = new THREE.Color(0x162238);
      if (tier.aoMode === 'n8ao_low') {
        n8ao.configuration.halfRes = true;
        n8ao.configuration.aoSamples = 6;
        n8ao.configuration.denoiseSamples = 3;
      } else if (tier.aoMode === 'n8ao_medium') {
        n8ao.configuration.halfRes = true;
        n8ao.configuration.aoSamples = 10;
        n8ao.configuration.denoiseSamples = 5;
      } else {
        n8ao.configuration.halfRes = false;
        n8ao.configuration.aoSamples = 14;
        n8ao.configuration.denoiseSamples = 8;
      }
      composer.addPass(n8ao);
      this.n8aoPass = n8ao;
    }

    const effects: Array<BloomEffect | SMAAEffect | ToneMappingEffect | VignetteEffect> = [];
    if (tier.bloomEnabled) {
      effects.push(
        new BloomEffect({
          mipmapBlur: true,
          luminanceThreshold: 0.9,
          luminanceSmoothing: 0.28,
          intensity: 0.65,
          radius: 0.62,
        })
      );
    }
    if (tier.smaaEnabled) {
      effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));

    if (tier.vignetteGrainEnabled) {
      effects.push(new VignetteEffect({ offset: 0.46, darkness: 0.22 }));
    }

    composer.addPass(new EffectPass(camera, ...effects));
    this.composer = composer;
  }

  public setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
    this.n8aoPass?.setSize(w, h);
  }

  public render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (this.composer) {
      this.composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  public dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.n8aoPass = null;
  }
}
