import * as THREE from 'three';

export type HeroClass = 'warden' | 'mage' | 'ranger' | 'rogue';
export interface CharacterAppearance {
  name: string;
  sex: 'm' | 'f';
  skin: number;
  eyes: number;
  hairStyle: 'short' | 'long' | 'braid' | 'ponytail' | 'bald';
  hairColor: number;
  beardStyle: 'none' | 'stubble' | 'goatee' | 'full' | 'long' | 'braided';
  height: number;
  bulk: number;
  heroClass: HeroClass;
  accent: number;
}
export interface CharacterUpdateState {
  speed?: number;
  turnRate?: number;
  crouching?: boolean;
  swimming?: boolean;
  blocking?: boolean;
  airborne?: boolean;
}
export type CharacterAction = 'strike' | 'cast' | 'block' | 'wave' | 'shoot' | 'thrust' | 'castPush' | 'castPoint' | 'castCone' | 'castSweep';
export type AttackStyle = 'sword' | 'bow' | 'staff' | 'dagger' | 'axe' | 'hammer' | 'spear' | 'unarmed';
export interface Character {
  root: THREE.Group;
  bones: Record<string, THREE.Object3D>;
  props: { weapon?: THREE.Object3D; shield?: THREE.Object3D; bow?: THREE.Object3D };
  update(dt: number, state?: CharacterUpdateState): void;
  play(name: CharacterAction): number;
  isBusy(): boolean;
  attackStyle: AttackStyle;
  getCastPoint(target?: THREE.Vector3, side?: 'L' | 'R'): THREE.Vector3;
  dispose(): void;
  capsule: { height: number; radius: number };
}
export type CharacterOptions = Record<string, unknown>;

export const SKIN_TONES: number[];
export const HAIR_STYLES: CharacterAppearance['hairStyle'][];
export const BEARD_STYLES: CharacterAppearance['beardStyle'][];
export const HAIR_COLORS: number[];
export const EYE_COLORS: number[];
export const ACCENT_COLORS: number[];
export const HERO_CLASSES: Record<HeroClass, { label: string; blurb: string }>;
export const PRESETS: Record<string, CharacterOptions>;
export const NPC_LOOKS: Record<string, CharacterOptions>;
export function createCharacter(presetOrOptions?: string | CharacterOptions, overrides?: CharacterOptions): Character;
export function createNPC(preset: string, rng?: () => number): Character;
export function defaultAppearance(): CharacterAppearance;
export function randomAppearance(rng?: () => number): CharacterAppearance;
export function appearanceToOptions(a?: Partial<CharacterAppearance> | null): CharacterOptions;
