import * as THREE from 'three';

interface ActiveParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  gravity: number;
  color: THREE.Color;
}

/**
 * Zero-allocation instanced particle pool (1 draw call for up to 512 particles)
 * used for spells, sword sparks, campfire embers, cannon blasts, and water splashes.
 */
export class ParticlePool {
  public readonly mesh: THREE.InstancedMesh;
  private readonly particles: ActiveParticle[] = [];
  private readonly capacity: number;
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(capacity = 512) {
    this.capacity = capacity;
    const geo = new THREE.OctahedronGeometry(0.22, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 0,
        gravity: 9.8,
        color: new THREE.Color(0xffffff),
      });
      this.dummy.position.set(0, -999, 0);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.particles[i].color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public spawnBurst(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count = 16,
    opts: { speed?: number; upBias?: number; scale?: number; gravity?: number; life?: number } = {}
  ): void {
    const speed = opts.speed ?? 6.5;
    const upBias = opts.upBias ?? 2.8;
    const baseScale = opts.scale ?? 1.0;
    const gravity = opts.gravity ?? 9.2;
    const life = opts.life ?? 0.65;

    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;

      const theta = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.85) * speed;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(theta) * spd;
      p.vz = Math.sin(theta) * spd;
      p.vy = upBias + Math.random() * (speed * 0.55);
      p.maxLife = life * (0.65 + Math.random() * 0.55);
      p.life = p.maxLife;
      p.scale = baseScale * (0.7 + Math.random() * 0.6);
      p.gravity = gravity;
      p.color.setHex(colorHex);
      this.mesh.setColorAt(this.cursor === 0 ? this.capacity - 1 : this.cursor - 1, p.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public update(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyActive = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const t = Math.max(0.05, p.life / p.maxLife);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.life * 6, p.life * 4, 0);
      this.dummy.scale.setScalar(p.scale * t);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (anyActive) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
