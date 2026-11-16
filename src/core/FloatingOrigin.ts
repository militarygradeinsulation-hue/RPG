import * as THREE from 'three';

/**
 * FloatingOrigin prevents floating-point vertex jitter when players sail or hike
 * thousands of meters from (0, 0). World simulation stays in canonical doubles
 * (worldX, worldZ) while the Three.js scene root translates cleanly around (originX, originZ).
 */
export class FloatingOrigin {
  public originX = 0;
  public originZ = 0;
  private readonly thresholdMeters = 1024;

  public update(worldX: number, worldZ: number, shiftedObjects: THREE.Object3D[]): boolean {
    const dx = worldX - this.originX;
    const dz = worldZ - this.originZ;
    if (Math.abs(dx) < this.thresholdMeters && Math.abs(dz) < this.thresholdMeters) {
      return false;
    }

    const snapX = Math.round(worldX / 512) * 512;
    const snapZ = Math.round(worldZ / 512) * 512;
    const shiftX = snapX - this.originX;
    const shiftZ = snapZ - this.originZ;
    if (shiftX === 0 && shiftZ === 0) return false;

    this.originX = snapX;
    this.originZ = snapZ;

    for (const obj of shiftedObjects) {
      obj.position.x -= shiftX;
      obj.position.z -= shiftZ;
    }
    return true;
  }

  public toLocalX(worldX: number): number {
    return worldX - this.originX;
  }

  public toLocalZ(worldZ: number): number {
    return worldZ - this.originZ;
  }
}
