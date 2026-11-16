import * as THREE from 'three';
import styles from '../data/sanctumStyles.json';
import type { BiomeId } from '../types/game';

/** Flush architectural inlays: no new obstacles or per-frame work. */
export function createSanctumInlays(biome: BiomeId, radius: number): THREE.Group {
  const style = styles[biome];
  const group = new THREE.Group();
  group.userData.ownedSanctumDetail = true;
  const metal = new THREE.MeshStandardMaterial({
    color: style.accent, emissive: style.accent, emissiveIntensity: 0.65,
    metalness: 0.7, roughness: 0.32, side: THREE.DoubleSide,
  });
  for (let i = 0; i < style.rings; i++) {
    const r = radius * (0.45 + i * 0.15);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.065, style.sides), metal);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
  }
  // Reuse one geometry/material through an instanced draw call.
  const marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.55), metal, 24);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    transform.position.set(Math.sin(angle) * radius, 0.002, Math.cos(angle) * radius);
    transform.rotation.set(-Math.PI / 2, 0, -angle);
    transform.updateMatrix();
    marks.setMatrixAt(i, transform.matrix);
  }
  group.add(marks);
  return group;
}
