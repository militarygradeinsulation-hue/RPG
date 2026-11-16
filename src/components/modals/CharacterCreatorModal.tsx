import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Dices, Play } from 'lucide-react';
import {
  ACCENT_COLORS,
  BEARD_STYLES,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  HERO_CLASSES,
  SKIN_TONES,
  appearanceToOptions,
  createCharacter,
  defaultAppearance,
  randomAppearance,
} from '../../engine/characters.js';
import type { Character, CharacterAppearance, HeroClass } from '../../engine/characters.js';

interface Props {
  initial?: Partial<CharacterAppearance> | null;
  confirmLabel?: string;
  onConfirm: (appearance: CharacterAppearance) => void;
  onCancel?: () => void;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const NAME_MAX = 24;

/** Live 3D preview of the hero being built. Rebuilds the rig when the look changes. */
function HeroPreview({ appearance, pose }: { appearance: CharacterAppearance; pose: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; char: Character | null; pose: string } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    camera.position.set(0, 1.25, 5.2);
    camera.lookAt(0, 0.98, 0);

    const key = new THREE.DirectionalLight(0xdfe8ff, 2.4);
    key.position.set(-3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const warm = new THREE.PointLight(0xffa04a, 10, 10, 2);
    warm.position.set(2.5, 1.8, 2.5);
    scene.add(warm);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 1.6);
    rim.position.set(1, 3, -5);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0x6a7faa, 0x2a2420, 0.7));
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    sceneRef.current = { scene, char: null, pose: 'idle' };

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let drag = false;
    let lastX = 0;
    let yaw = 0.35;
    const onDown = (e: PointerEvent) => { drag = true; lastX = e.clientX; };
    const onMove = (e: PointerEvent) => { if (drag) { yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; } };
    const onUp = () => { drag = false; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = sceneRef.current;
      if (st?.char) {
        if (!drag) yaw += dt * 0.25;
        st.char.root.rotation.y = yaw;
        st.char.update(dt, { speed: st.pose === 'walk' ? 1.6 : st.pose === 'run' ? 6.5 : 0 });
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      sceneRef.current?.char?.dispose();
      pmrem.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Rebuild the character whenever the look changes.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const prevYaw = st.char?.root.rotation.y ?? 0.35;
    if (st.char) {
      st.scene.remove(st.char.root);
      st.char.dispose();
    }
    const c = createCharacter(appearanceToOptions(appearance));
    c.root.rotation.y = prevYaw;
    st.scene.add(c.root);
    st.char = c;
  }, [appearance]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.pose = pose;
  }, [pose]);

  return <div ref={hostRef} className="w-full h-full touch-none-canvas cursor-grab active:cursor-grabbing" aria-label="Hero preview. Drag to rotate." />;
}

function Swatches({ colors, value, onPick, label }: { colors: number[]; value: number; onPick: (c: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`${label} ${hex(c)}`}
          onClick={() => onPick(c)}
          className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${value === c ? 'border-amber-300 scale-110' : 'border-white/20'}`}
          style={{ background: hex(c) }}
        />
      ))}
    </div>
  );
}

function Chips<T extends string>({ options, value, onPick, label, format }: { options: readonly T[]; value: T; onPick: (v: T) => void; label: string; format?: (v: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onPick(o)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize border transition-colors ${value === o ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-900/70 text-slate-200 border-white/15 hover:border-amber-300/60'}`}
        >
          {format ? format(o) : o}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.18em] text-amber-200/80 font-semibold">{label}</span>
      {children}
    </div>
  );
}

export default function CharacterCreatorModal({ initial, confirmLabel = 'Begin Chronicle', onConfirm, onCancel }: Props) {
  const [a, setA] = useState<CharacterAppearance>(() => ({ ...defaultAppearance(), ...(initial || {}) }));
  const [pose, setPose] = useState<'idle' | 'walk' | 'run'>('idle');
  const set = <K extends keyof CharacterAppearance>(k: K, v: CharacterAppearance[K]) => setA((p) => ({ ...p, [k]: v }));

  // Only rebuild the rig for look changes, not for every name keystroke.
  const { name: _name, ...look } = a;
  const lookKey = JSON.stringify(look);
  const lookForPreview = useMemo(() => ({ ...a }), [lookKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = a.name.trim();
  const nameOk = trimmed.length >= 2 && trimmed.length <= NAME_MAX && /^[\p{L}\p{N} '\-]+$/u.test(trimmed);

  const submit = () => {
    if (!nameOk) return;
    onConfirm({ ...a, name: trimmed });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-2 sm:p-3" role="dialog" aria-modal="true" aria-label="Create your hero">
      <div className="hud-panel w-full max-w-5xl h-[min(94dvh,720px)] rounded-2xl border border-amber-300/25 shadow-2xl flex flex-col md:flex-row overflow-hidden">
        <div className="relative shrink-0 md:w-[44%] h-48 sm:h-56 md:h-auto bg-gradient-to-b from-slate-900 to-slate-950">
          <HeroPreview appearance={lookForPreview} pose={pose} />
          <div className="absolute top-3 left-0 right-0 text-center pointer-events-none">
            <div className="font-display text-xl sm:text-2xl text-amber-200 tracking-wider drop-shadow">{trimmed || 'Your Hero'}</div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-amber-100/70">{HERO_CLASSES[a.heroClass].label}</div>
          </div>
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {(['idle', 'walk', 'run'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPose(p)} className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize border ${pose === p ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-900/80 text-slate-200 border-white/15'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-white/10">
            <h2 className="font-display text-xl text-amber-200 tracking-wide">Create Your Hero</h2>
            <button
              type="button"
              onClick={() => setA((p) => ({ ...randomAppearance(), name: p.name }))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900/80 border border-white/15 text-slate-200 hover:border-amber-300/60"
            >
              <Dices className="w-3.5 h-3.5" /> Randomize
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div className="sm:col-span-2">
              <Row label="Name">
                <input
                  autoFocus
                  value={a.name}
                  maxLength={NAME_MAX}
                  onChange={(e) => set('name', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder="Enter your hero's name"
                  className="w-full rounded-lg bg-slate-950/80 border border-white/20 focus:border-amber-300 outline-none px-3 py-2 text-slate-100 font-display tracking-wide"
                />
                {!nameOk && a.name.length > 0 && (
                  <span className="text-[11px] text-rose-300">2 to {NAME_MAX} characters. Letters, numbers, spaces, ' and - only.</span>
                )}
              </Row>
            </div>

            <div className="sm:col-span-2">
              <Row label="Path">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(HERO_CLASSES) as HeroClass[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => set('heroClass', k)}
                      className={`text-left p-2.5 rounded-lg border transition-colors ${a.heroClass === k ? 'bg-amber-500/15 border-amber-400' : 'bg-slate-900/60 border-white/10 hover:border-amber-300/50'}`}
                    >
                      <div className="text-sm font-bold text-amber-100">{HERO_CLASSES[k].label}</div>
                      <div className="text-[11px] text-slate-300 leading-snug">{HERO_CLASSES[k].blurb}</div>
                    </button>
                  ))}
                </div>
              </Row>
            </div>

            <Row label="Body">
              <Chips options={['m', 'f'] as const} value={a.sex} label="Body" format={(v) => (v === 'm' ? 'Masculine' : 'Feminine')} onPick={(v) => setA((p) => ({ ...p, sex: v, beardStyle: v === 'f' ? 'none' : p.beardStyle, height: v === 'f' ? Math.min(p.height, 1.8) : p.height }))} />
            </Row>
            <Row label="Skin">
              <Swatches colors={SKIN_TONES} value={a.skin} onPick={(c) => set('skin', c)} label="Skin tone" />
            </Row>
            <Row label={`Height ${a.height.toFixed(2)} m`}>
              <input type="range" min={1.55} max={1.98} step={0.01} value={a.height} onChange={(e) => set('height', +e.target.value)} className="accent-amber-400" />
            </Row>
            <Row label="Build">
              <input type="range" min={0.85} max={1.3} step={0.01} value={a.bulk} onChange={(e) => set('bulk', +e.target.value)} className="accent-amber-400" aria-label="Build" />
            </Row>
            <Row label="Hair">
              <Chips options={HAIR_STYLES} value={a.hairStyle} label="Hair style" onPick={(v) => set('hairStyle', v)} />
            </Row>
            <Row label="Hair Color">
              <Swatches colors={HAIR_COLORS} value={a.hairColor} onPick={(c) => set('hairColor', c)} label="Hair color" />
            </Row>
            <Row label="Beard">
              <Chips options={BEARD_STYLES} value={a.beardStyle} label="Beard" onPick={(v) => set('beardStyle', v)} />
            </Row>
            <Row label="Eyes">
              <Swatches colors={EYE_COLORS} value={a.eyes} onPick={(c) => set('eyes', c)} label="Eye color" />
            </Row>
            <div className="sm:col-span-2">
              <Row label="Colors (cloak, tunic, shield)">
                <Swatches colors={ACCENT_COLORS} value={a.accent} onPick={(c) => set('accent', c)} label="Accent color" />
              </Row>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-white/10 flex items-center justify-end gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-200 border border-white/15 hover:border-white/40">
                Cancel
              </button>
            )}
            <button
              type="button"
              disabled={!nameOk}
              onClick={submit}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-display font-bold text-sm tracking-wide flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-slate-950" /> {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
