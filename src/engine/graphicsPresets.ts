import * as THREE from 'three';
import { GraphicsPreset, ResolvedGraphicsTier } from '../types/game';

export interface GraphicsTierConfig {
  tier: ResolvedGraphicsTier;
  label: string;
  pixelRatioMax: number;
  shadowsEnabled: boolean;
  useCsm: boolean;
  shadowMapSize: number;
  csmCascades: number;
  aoMode: 'off' | 'n8ao_low' | 'n8ao_medium' | 'n8ao_high';
  bloomEnabled: boolean;
  smaaEnabled: boolean;
  vignetteGrainEnabled: boolean;
  transmissionEnabled: boolean;
  treeCount: number;
  grassCount: number;
  snowCount: number;
  maxMagicPointLights: number;
  textureResolution: number;
  anisotropyMax: number;
}

export const GRAPHICS_PRESETS: Record<ResolvedGraphicsTier, GraphicsTierConfig> = {
  low: {
    tier: 'low',
    label: 'Low (30+ fps Iris Xe)',
    pixelRatioMax: 1.0,
    shadowsEnabled: true,
    useCsm: false,
    shadowMapSize: 1024,
    csmCascades: 1,
    aoMode: 'off',
    bloomEnabled: false,
    smaaEnabled: false,
    vignetteGrainEnabled: false,
    transmissionEnabled: false,
    treeCount: 110,
    grassCount: 90,
    snowCount: 280,
    maxMagicPointLights: 2,
    textureResolution: 512,
    anisotropyMax: 2,
  },
  medium: {
    tier: 'medium',
    label: 'Medium (Balanced)',
    pixelRatioMax: 1.25,
    shadowsEnabled: true,
    useCsm: true,
    shadowMapSize: 1024,
    csmCascades: 2,
    aoMode: 'n8ao_low',
    bloomEnabled: true,
    smaaEnabled: false,
    vignetteGrainEnabled: true,
    transmissionEnabled: false,
    treeCount: 160,
    grassCount: 150,
    snowCount: 440,
    maxMagicPointLights: 4,
    textureResolution: 512,
    anisotropyMax: 4,
  },
  high: {
    tier: 'high',
    label: 'High (60 fps 1080p Target)',
    pixelRatioMax: 1.5,
    shadowsEnabled: true,
    useCsm: true,
    shadowMapSize: 2048,
    csmCascades: 3,
    aoMode: 'n8ao_medium',
    bloomEnabled: true,
    smaaEnabled: true,
    vignetteGrainEnabled: true,
    transmissionEnabled: true,
    treeCount: 220,
    grassCount: 210,
    snowCount: 680,
    maxMagicPointLights: 6,
    textureResolution: 1024,
    anisotropyMax: 8,
  },
  ultra: {
    tier: 'ultra',
    label: 'Ultra (Max Fidelity)',
    pixelRatioMax: 2.0,
    shadowsEnabled: true,
    useCsm: true,
    shadowMapSize: 2048,
    csmCascades: 3,
    aoMode: 'n8ao_high',
    bloomEnabled: true,
    smaaEnabled: true,
    vignetteGrainEnabled: true,
    transmissionEnabled: true,
    treeCount: 280,
    grassCount: 260,
    snowCount: 920,
    maxMagicPointLights: 8,
    textureResolution: 1024,
    anisotropyMax: 16,
  },
};

export function detectInitialGpuTier(renderer: THREE.WebGLRenderer, isSoftwareGl: boolean): ResolvedGraphicsTier {
  if (isSoftwareGl) return 'low';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rawRenderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rawRenderer)) return 'low';
    if (/RTX|RX 6[6-9]|RX 7|M2 Pro|M2 Max|M3|M4|GTX 1660|GTX 1070|GTX 1080|Radeon Pro/i.test(rawRenderer)) {
      return 'high';
    }
    if (/Apple M1|Apple GPU|GTX|Iris Xe|Arc/i.test(rawRenderer)) {
      return /Iris Xe|UHD|HD Graphics/i.test(rawRenderer) ? 'medium' : 'high';
    }
    if (/UHD|HD Graphics|Mali|Adreno|Vega 3|Vega 6/i.test(rawRenderer)) {
      return 'low';
    }
  } catch {
    // Fallback to medium
  }
  return renderer.capabilities.maxTextureSize >= 8192 ? 'high' : 'medium';
}

export function resolveTierFromPreset(
  preset: GraphicsPreset,
  detectedTier: ResolvedGraphicsTier
): ResolvedGraphicsTier {
  return preset === 'auto' ? detectedTier : preset;
}
