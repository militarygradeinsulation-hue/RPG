import * as THREE from 'three';
import { FloatingOrigin } from '../core/FloatingOrigin';

/**
 * CombatFX: physical projectiles and spell visuals for player attacks.
 *
 * All simulation runs in canonical WORLD coordinates (same as EnemyRuntime.x/z).
 * Meshes are re-placed in local scene space every frame through the FloatingOrigin,
 * so effects stay correct when the origin shifts.
 */

export interface FxTarget {
  x: number;
  z: number;
  alive: boolean;
  isDragon?: boolean;
}

export type ProjectileHit = (target: FxTarget | null, at: THREE.Vector3) => void;

interface Projectile {
  obj: THREE.Object3D;
  light?: THREE.PointLight;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  life: number;
  radius: number;
  homing: FxTarget | null;
  homingRate: number;
  trailColor?: number;
  trailTimer: number;
  orient: boolean;
  spin: number;
  explodeOnExpire: boolean;
  onHit: ProjectileHit;
}

interface Transient {
  obj: THREE.Object3D;
  world: THREE.Vector3;
  t: number;
  dur: number;
  tick: (k: number, obj: THREE.Object3D) => void;
  light?: THREE.PointLight;
}

interface Delayed {
  t: number;
  fn: () => void;
}

export type BurstFn = (lx: number, ly: number, lz: number, color: number, count: number) => void;

const additive = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

export class CombatFX {
  private readonly group = new THREE.Group();
  private readonly projectiles: Projectile[] = [];
  private readonly transients: Transient[] = [];
  private readonly delayed: Delayed[] = [];
  private readonly geo = {
    orb: new THREE.SphereGeometry(1, 16, 12),
    shard: new THREE.OctahedronGeometry(1, 0),
    ring: new THREE.RingGeometry(0.75, 1, 48),
    torus: new THREE.TorusGeometry(1, 0.06, 8, 40),
  };
  private readonly tmp = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    private readonly origin: FloatingOrigin,
    private readonly burst: BurstFn
  ) {
    this.group.name = 'CombatFX';
    parent.add(this.group);
  }

  /** Converts a scene-space point (e.g. a hand bone's world position) to canonical world coordinates. */
  public toWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(local.x + this.origin.originX, local.y, local.z + this.origin.originZ);
  }

  private place(obj: THREE.Object3D, world: THREE.Vector3) {
    obj.position.set(this.origin.toLocalX(world.x), world.y, this.origin.toLocalZ(world.z));
  }

  /** Runs fn after `seconds` of game time (used to sync the projectile release with the animation). */
  public after(seconds: number, fn: () => void) {
    this.delayed.push({ t: seconds, fn });
  }

  // ------------------------------------------------------------------
  // Projectiles
  // ------------------------------------------------------------------

  /** Aims a launch velocity at a world point, compensating for gravity drop. */
  private aim(from: THREE.Vector3, to: THREE.Vector3, speed: number, gravity: number): THREE.Vector3 {
    const d = this.tmp.copy(to).sub(from);
    const flat = Math.hypot(d.x, d.z);
    const t = Math.max(0.05, Math.hypot(flat, d.y) / speed);
    const v = d.clone().divideScalar(t);
    v.y += 0.5 * gravity * t;
    return v;
  }

  public arrow(from: THREE.Vector3, aimAt: THREE.Vector3, onHit: ProjectileHit, target: FxTarget | null = null) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.75, 5).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 })
    );
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.028, 0.09, 4).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.35 })
    );
    head.position.z = 0.42;
    const fletchMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), fletchMat);
      f.position.z = -0.32;
      f.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
      g.add(f);
    }
    g.add(shaft, head);
    // faint streak so fast arrows read on screen
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.02, 1.4, 6).rotateX(Math.PI / 2), additive(0xfff4d6, 0.35));
    streak.position.z = -0.9;
    g.add(streak);
    this.group.add(g);
    const gravity = 9.81;
    this.projectiles.push({
      obj: g,
      pos: from.clone(),
      vel: this.aim(from, aimAt, 62, gravity),
      gravity,
      life: 2.2,
      radius: 0.9,
      homing: target,
      homingRate: 0,
      trailTimer: 0,
      orient: true,
      spin: 0,
      explodeOnExpire: false,
      onHit,
    });
  }

  /** Glowing orb: arcane bolt (staff) or fireball. Fireballs explode on ground, target, or expiry. */
  public orb(
    kind: 'arcane' | 'fire',
    from: THREE.Vector3,
    aimAt: THREE.Vector3,
    onHit: ProjectileHit,
    target: FxTarget | null = null,
    color = kind === 'fire' ? 0xff7a1a : 0xffd66b
  ) {
    const g = new THREE.Group();
    const size = kind === 'fire' ? 0.32 : 0.18;
    const core = new THREE.Mesh(
      this.geo.orb,
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: kind === 'fire' ? 6 : 4 })
    );
    core.scale.setScalar(size * 0.6);
    const halo = new THREE.Mesh(this.geo.orb, additive(color, 0.55));
    halo.scale.setScalar(size);
    const outer = new THREE.Mesh(this.geo.orb, additive(kind === 'fire' ? 0xff3300 : color, 0.2));
    outer.scale.setScalar(size * 1.9);
    g.add(core, halo, outer);
    const light = new THREE.PointLight(color, kind === 'fire' ? 30 : 12, kind === 'fire' ? 12 : 7, 2);
    g.add(light);
    this.group.add(g);
    const speed = kind === 'fire' ? 26 : 34;
    const gravity = kind === 'fire' ? 2.5 : 0;
    this.projectiles.push({
      obj: g,
      light,
      pos: from.clone(),
      vel: this.aim(from, aimAt, speed, gravity),
      gravity,
      life: kind === 'fire' ? 1.6 : 1.3,
      radius: kind === 'fire' ? 1.1 : 0.9,
      homing: target,
      homingRate: kind === 'arcane' ? 5 : 1.2,
      trailColor: kind === 'fire' ? 0xff6a00 : color,
      trailTimer: 0,
      orient: false,
      spin: 6,
      explodeOnExpire: kind === 'fire',
      onHit,
    });
  }

  // ------------------------------------------------------------------
  // Instant / transient effects
  // ------------------------------------------------------------------

  private addTransient(obj: THREE.Object3D, world: THREE.Vector3, dur: number, tick: Transient['tick'], light?: THREE.PointLight) {
    this.group.add(obj);
    this.place(obj, world);
    this.transients.push({ obj, world: world.clone(), t: 0, dur, tick, light });
  }

  public explosion(at: THREE.Vector3, color: number, radius: number) {
    const g = new THREE.Group();
    const flash = new THREE.Mesh(this.geo.orb, additive(0xfff0c0, 0.9));
    const fire = new THREE.Mesh(this.geo.orb, additive(color, 0.7));
    const smoke = new THREE.Mesh(this.geo.orb, new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.4, depthWrite: false }));
    const shock = new THREE.Mesh(this.geo.ring, additive(color, 0.8));
    shock.rotation.x = -Math.PI / 2;
    g.add(flash, fire, smoke, shock);
    const light = new THREE.PointLight(color, 120, radius * 5, 2);
    g.add(light);
    this.addTransient(g, at, 0.9, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      flash.scale.setScalar(radius * 0.5 * (1 + e));
      (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - k * 3);
      fire.scale.setScalar(radius * (0.3 + e * 0.8));
      (fire.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
      smoke.scale.setScalar(radius * (0.4 + e * 1.1));
      smoke.position.y = e * radius * 0.6;
      (smoke.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - k);
      shock.scale.setScalar(radius * (0.2 + e * 1.4));
      (shock.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      light.intensity = 120 * Math.pow(1 - k, 2);
    }, light);
    this.burst(this.origin.toLocalX(at.x), at.y, this.origin.toLocalZ(at.z), color, 26);
  }

  /** Jagged lightning from `from` through each point in `chain` (world coords). */
  public lightning(from: THREE.Vector3, chain: THREE.Vector3[], color = 0x9fe0ff) {
    let a = from.clone();
    chain.forEach((b, idx) => {
      const start = a.clone();
      const end = b.clone();
      const g = new THREE.Group();
      const build = () => {
        g.clear();
        const seg = 14;
        const pts: THREE.Vector3[] = [];
        const len = start.distanceTo(end);
        for (let i = 0; i <= seg; i++) {
          const t = i / seg;
          const p = new THREE.Vector3().lerpVectors(start, end, t).sub(start);
          if (i > 0 && i < seg) {
            const j = len * 0.06 * Math.sin(t * Math.PI);
            p.x += (Math.random() - 0.5) * j * 2;
            p.y += (Math.random() - 0.5) * j * 2;
            p.z += (Math.random() - 0.5) * j * 2;
          }
          pts.push(p);
        }
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg * 2, 0.045, 5), additive(0xffffff, 1)));
        g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg * 2, 0.16, 6), additive(color, 0.55)));
      };
      build();
      const light = new THREE.PointLight(color, 90, 22, 2);
      light.position.copy(end).sub(start);
      g.add(light);
      let rebuild = 0;
      this.addTransient(g, start, 0.32 + idx * 0.05, (k) => {
        rebuild++;
        if (rebuild % 3 === 0 && k < 0.7) {
          build();
          g.add(light);
        }
        g.children.forEach((c) => {
          const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m && 'opacity' in m) m.opacity = (m.color.getHex() === 0xffffff ? 1 : 0.55) * (1 - k);
        });
        light.intensity = 90 * (1 - k) * (0.6 + Math.random() * 0.4);
      }, light);
      this.burst(this.origin.toLocalX(end.x), end.y, this.origin.toLocalZ(end.z), color, 14);
      a = b;
    });
  }

  /** Spray of ice shards and frost mist across a cone in the facing direction. */
  public frostCone(from: THREE.Vector3, yaw: number, range: number, halfAngle: number) {
    const shardMat = new THREE.MeshPhysicalMaterial({ color: 0xcff6ff, emissive: 0x67e8f9, emissiveIntensity: 1.2, roughness: 0.1, transmission: 0.4, thickness: 0.2 });
    const g = new THREE.Group();
    const shards: { m: THREE.Mesh; dir: THREE.Vector3; spd: number }[] = [];
    for (let i = 0; i < 22; i++) {
      const a = yaw + (Math.random() * 2 - 1) * halfAngle;
      const dir = new THREE.Vector3(Math.sin(a), (Math.random() - 0.35) * 0.25, Math.cos(a)).normalize();
      const m = new THREE.Mesh(this.geo.shard, shardMat);
      m.scale.set(0.05, 0.05, 0.22 + Math.random() * 0.2);
      m.lookAt(dir);
      g.add(m);
      shards.push({ m, dir, spd: range * (0.8 + Math.random() * 0.5) });
    }
    const mist = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(halfAngle) * range * 0.55, range, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, range / 2), additive(0xa5f3fc, 0.14));
    mist.rotation.y = yaw;
    g.add(mist);
    const light = new THREE.PointLight(0x9be7ff, 40, range * 1.6, 2);
    light.position.set(Math.sin(yaw) * range * 0.4, 0, Math.cos(yaw) * range * 0.4);
    g.add(light);
    this.addTransient(g, from, 0.6, (k) => {
      shards.forEach(({ m, dir, spd }) => {
        m.position.copy(dir).multiplyScalar(spd * Math.min(1, k * 1.6));
        m.visible = k < 0.85;
      });
      mist.scale.setScalar(0.3 + k * 0.9);
      (mist.material as THREE.MeshBasicMaterial).opacity = 0.14 * (1 - k) * (1 - k);
      light.intensity = 40 * (1 - k);
    }, light);
  }

  /** Expanding wind rings and a vortex column. */
  public galeBurst(at: THREE.Vector3, radius: number) {
    const g = new THREE.Group();
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(this.geo.torus, additive(0xa7f3d0, 0.7));
      r.rotation.x = Math.PI / 2;
      g.add(r);
      rings.push(r);
    }
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.2, 5, 24, 1, true), additive(0x6ee7b7, 0.18));
    column.position.y = 2.5;
    g.add(column);
    this.addTransient(g, at, 0.8, (k) => {
      rings.forEach((r, i) => {
        const kk = Math.max(0, k * 1.3 - i * 0.15);
        r.scale.setScalar(0.5 + kk * radius);
        r.position.y = 0.3 + i * 0.6 + kk * 1.2;
        r.rotation.z += 0.3;
        (r.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.max(0, 1 - kk);
      });
      column.rotation.y += 0.4;
      column.scale.set(1 + k, 1 + k * 0.5, 1 + k);
      (column.material as THREE.MeshBasicMaterial).opacity = 0.18 * (1 - k);
    });
  }

  /** Weapon trail arc in front of the attacker. */
  public slash(at: THREE.Vector3, yaw: number, opts: { color?: number; radius?: number; arc?: number; tilt?: number; thin?: boolean } = {}) {
    const radius = opts.radius ?? 2.2;
    const arc = opts.arc ?? 2.4;
    const geo = new THREE.RingGeometry(radius * (opts.thin ? 0.85 : 0.55), radius, 40, 1, Math.PI / 2 - arc / 2, arc);
    const m = new THREE.Mesh(geo, additive(opts.color ?? 0xfff1c2, 0.75));
    const g = new THREE.Group();
    m.rotation.x = -Math.PI / 2;
    g.add(m);
    g.rotation.set(opts.tilt ?? 0.25, yaw, 0, 'YXZ');
    this.addTransient(g, at, 0.22, (k) => {
      (m.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
      m.rotation.z = -k * 0.6;
      m.scale.setScalar(0.9 + k * 0.15);
    });
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  public update(dt: number, targets: FxTarget[], groundAt: (x: number, z: number) => number) {
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i];
      d.t -= dt;
      if (d.t <= 0) {
        this.delayed.splice(i, 1);
        d.fn();
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.homing && p.homing.alive && p.homingRate > 0) {
        const want = this.tmp.set(p.homing.x - p.pos.x, groundAt(p.homing.x, p.homing.z) + 1.2 - p.pos.y, p.homing.z - p.pos.z).normalize().multiplyScalar(p.vel.length());
        p.vel.lerp(want, Math.min(1, dt * p.homingRate));
      }
      p.vel.y -= p.gravity * dt;
      // sub-step so fast arrows never tunnel past a target
      const steps = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.5));
      let hit: FxTarget | null = null;
      let ended = false;
      for (let s = 0; s < steps && !ended; s++) {
        p.pos.addScaledVector(p.vel, dt / steps);
        for (const t of targets) {
          if (!t.alive) continue;
          const r = p.radius + (t.isDragon ? 3.2 : 0.6);
          if (Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < r) {
            const gy = groundAt(t.x, t.z);
            if (t.isDragon || (p.pos.y > gy - 0.5 && p.pos.y < gy + 3.2)) {
              hit = t;
              ended = true;
              break;
            }
          }
        }
        if (!ended && p.pos.y <= groundAt(p.pos.x, p.pos.z)) ended = true;
      }
      if (!ended && p.life <= 0) ended = true;

      if (p.trailColor !== undefined) {
        p.trailTimer -= dt;
        if (p.trailTimer <= 0) {
          p.trailTimer = 0.03;
          this.burst(this.origin.toLocalX(p.pos.x), p.pos.y, this.origin.toLocalZ(p.pos.z), p.trailColor, 2);
        }
      }

      if (ended) {
        this.group.remove(p.obj);
        this.disposeObj(p.obj);
        this.projectiles.splice(i, 1);
        if (hit || p.explodeOnExpire || p.life > 0) p.onHit(hit, p.pos.clone());
        continue;
      }
      this.place(p.obj, p.pos);
      if (p.orient) p.obj.lookAt(this.tmp.copy(p.obj.position).add(p.vel));
      if (p.spin) p.obj.rotation.y += p.spin * dt;
      if (p.light) p.light.intensity *= 0.98 + Math.random() * 0.04;
    }

    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i];
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      this.place(tr.obj, tr.world);
      tr.tick(k, tr.obj);
      if (k >= 1) {
        this.group.remove(tr.obj);
        this.disposeObj(tr.obj);
        this.transients.splice(i, 1);
      }
    }
  }

  private disposeObj(obj: THREE.Object3D) {
    const shared = new Set<THREE.BufferGeometry>(Object.values(this.geo));
    obj.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) {
        if (!shared.has(m.geometry)) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
      }
    });
  }
}
