import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Anchor,
  ArrowDown,
  ArrowUp,
  Crosshair,
  Flame,
  Hand,
  Mic,
  Shield,
  Ship,
  Snowflake,
  Sparkles,
  Sword,
  Swords,
  WandSparkles,
  Wind,
  Zap,
} from 'lucide-react';
import type { HeroClass } from '../../engine/characters.js';
import { NearbyPrompt, PlayerState, ShipHudState } from '../../types/game';

interface MobileTouchControlsProps {
  heroClass: HeroClass;
  cooldowns: PlayerState['cooldowns'];
  isSwimming: boolean;
  isCrouching: boolean;
  isClimbing: boolean;
  shipHud: ShipHudState | null;
  primaryPrompt: NearbyPrompt | null;
  onMoveStick: (x: number, y: number, sprint: boolean) => void;
  onHoldState: (kind: 'sprint' | 'block' | 'ascend' | 'dive', active: boolean) => void;
  onAttack: () => void;
  onJump: () => void;
  onDodge: () => void;
  onToggleCrouch: () => void;
  onInteract: () => void;
  onCastSpell: (element: 'fire' | 'lightning' | 'frost' | 'gale') => void;
  onToggleAnchor: () => void;
  onFireBroadside: () => void;
  onOpenWheel: () => void;
  onOpenVoice: () => void;
}

const STICK_RADIUS = 46;

export const MobileTouchControls: React.FC<MobileTouchControlsProps> = ({
  heroClass,
  cooldowns,
  isSwimming,
  isCrouching,
  isClimbing,
  shipHud,
  primaryPrompt,
  onMoveStick,
  onHoldState,
  onAttack,
  onJump,
  onDodge,
  onToggleCrouch,
  onInteract,
  onCastSpell,
  onToggleAnchor,
  onFireBroadside,
  onOpenWheel,
  onOpenVoice,
}) => {
  const stickRef = useRef<HTMLDivElement>(null);
  const stickPointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; sprinting: boolean }>({
    x: 0,
    y: 0,
    sprinting: false,
  });
  const [sprintLocked, setSprintLocked] = useState(false);
  const [blockHeld, setBlockHeld] = useState(false);
  const [ascendHeld, setAscendHeld] = useState(false);
  const [diveHeld, setDiveHeld] = useState(false);

  const atHelm = Boolean(shipHud?.atHelm);

  useEffect(() => {
    return () => {
      onMoveStick(0, 0, false);
      onHoldState('block', false);
      onHoldState('ascend', false);
      onHoldState('dive', false);
    };
  }, [onMoveStick, onHoldState]);

  const updateStickFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = stickRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > STICK_RADIUS) {
        const scale = STICK_RADIUS / dist;
        dx *= scale;
        dy *= scale;
      }
      const normX = Math.abs(dx / STICK_RADIUS) < 0.08 ? 0 : dx / STICK_RADIUS;
      const normY = Math.abs(dy / STICK_RADIUS) < 0.08 ? 0 : -(dy / STICK_RADIUS);
      const mag = Math.hypot(normX, normY);
      const autoSprint = sprintLocked || mag > 0.84;
      setKnob({ x: dx, y: dy, sprinting: autoSprint && mag > 0.15 });
      onMoveStick(normX, normY, autoSprint && mag > 0.15);
    },
    [onMoveStick, sprintLocked]
  );

  const resetStick = useCallback(() => {
    stickPointerId.current = null;
    setKnob({ x: 0, y: 0, sprinting: false });
    onMoveStick(0, 0, false);
  }, [onMoveStick]);

  const PrimaryWeaponIcon =
    heroClass === 'ranger'
      ? Crosshair
      : heroClass === 'mage'
        ? WandSparkles
        : heroClass === 'rogue'
          ? Sword
          : Swords;

  const primaryLabel =
    heroClass === 'ranger'
      ? 'Shoot'
      : heroClass === 'mage'
        ? 'Bolt'
        : heroClass === 'rogue'
          ? 'Stab'
          : 'Slash';

  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none">
      {/* Left Thumb: Virtual Analog Joystick + Sprint Lock */}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(0.875rem,env(safe-area-inset-left))] flex flex-col items-start gap-2 pointer-events-none">
        {!atHelm && (
          <button
            type="button"
            onClick={() => setSprintLocked((v) => !v)}
            className={`pointer-events-auto touch-none-canvas min-w-[44px] min-h-[44px] px-3 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 shadow-lg transition-colors ${
              sprintLocked || knob.sprinting
                ? 'bg-amber-500 text-slate-950 border-amber-300'
                : 'bg-slate-900/90 text-slate-200 border-white/15'
            }`}
            aria-label="Toggle Sprint Lock"
          >
            <Wind className="w-3.5 h-3.5" />
            <span>{sprintLocked ? 'Sprint On' : atHelm ? 'Sail' : 'Sprint'}</span>
          </button>
        )}

        <div
          ref={stickRef}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            stickPointerId.current = e.pointerId;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Ignore
            }
            updateStickFromClient(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (stickPointerId.current !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();
            updateStickFromClient(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            if (stickPointerId.current !== e.pointerId) return;
            e.preventDefault();
            resetStick();
          }}
          onPointerCancel={(e) => {
            if (stickPointerId.current !== e.pointerId) return;
            resetStick();
          }}
          onLostPointerCapture={() => resetStick()}
          className={`pointer-events-auto touch-none-canvas relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border-2 flex items-center justify-center shadow-2xl ${
            knob.sprinting
              ? 'bg-slate-950/75 border-amber-400/80'
              : 'bg-slate-950/65 border-white/20'
          }`}
          aria-label={atHelm ? 'Ship Rudder and Sail Stick' : 'Movement Joystick'}
        >
          {/* Inner directional guide ring */}
          <div className="w-16 h-16 rounded-full border border-white/10 pointer-events-none" />
          <span className="absolute top-1.5 text-[9px] font-mono-tabular text-slate-400 pointer-events-none">
            {atHelm ? 'SAIL' : 'FWD'}
          </span>
          <span className="absolute bottom-1.5 text-[9px] font-mono-tabular text-slate-500 pointer-events-none">
            {atHelm ? 'FURL' : 'BACK'}
          </span>

          {/* Movable thumbstick puck */}
          <div
            style={{
              transform: `translate(${knob.x}px, ${knob.y}px)`,
            }}
            className={`w-12 h-12 rounded-full border-2 shadow-lg pointer-events-none transition-colors ${
              knob.sprinting
                ? 'bg-amber-400/90 border-amber-200'
                : 'bg-slate-800/95 border-amber-300/60'
            }`}
          />
        </div>
      </div>

      {/* Right Thumb: Interact Prompt, Elements, Tactical Wheel & Action Cluster */}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(0.875rem,env(safe-area-inset-right))] flex flex-col items-end gap-2 pointer-events-none">
        {/* Guaranteed >=44px Context Interact Pill */}
        {(primaryPrompt || atHelm) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInteract();
            }}
            className="pointer-events-auto touch-none-canvas min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-900/95 border-2 shadow-xl flex items-center gap-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            style={{ borderColor: atHelm ? '#38bdf8' : primaryPrompt?.color || '#fbbf24' }}
          >
            <Hand className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="max-w-[160px] truncate">
              {atHelm
                ? 'Leave Helm'
                : `${primaryPrompt?.label} · ${primaryPrompt?.actionHint.replace('[E] ', '')}`}
            </span>
          </button>
        )}

        {/* Quick Tactical Strip + Elements (hidden only when steering ship? Keep accessible!) */}
        <div className="flex items-center gap-1.5 pointer-events-none">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenVoice();
            }}
            aria-label="Voice & Parley"
            className="pointer-events-auto touch-none-canvas w-11 h-11 rounded-full bg-slate-900/90 border border-white/20 text-amber-300 flex items-center justify-center shadow-lg active:scale-95"
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenWheel();
            }}
            aria-label="Tactical Gesture Wheel"
            className="pointer-events-auto touch-none-canvas w-11 h-11 rounded-full bg-amber-500/95 border border-amber-300 text-slate-950 flex items-center justify-center shadow-lg active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {!atHelm && (
            <>
              {(
                [
                  { id: 'fire', Icon: Flame, color: 'text-orange-400', border: 'border-orange-400/50', cd: cooldowns.fire, label: 'Cast Fire' },
                  { id: 'lightning', Icon: Zap, color: 'text-sky-400', border: 'border-sky-400/50', cd: cooldowns.lightning, label: 'Cast Lightning' },
                  { id: 'frost', Icon: Snowflake, color: 'text-cyan-300', border: 'border-cyan-300/50', cd: cooldowns.frost, label: 'Cast Frost' },
                  { id: 'gale', Icon: Wind, color: 'text-emerald-400', border: 'border-emerald-400/50', cd: cooldowns.gale, label: 'Cast Gale' },
                ] as const
              ).map(({ id, Icon, color, border, cd, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCastSpell(id);
                  }}
                  aria-label={label}
                  className={`pointer-events-auto touch-none-canvas relative w-11 h-11 rounded-full bg-slate-900/90 border ${border} flex items-center justify-center shadow-lg active:scale-95`}
                >
                  <Icon className={`w-4 h-4 ${color} ${cd > 0 ? 'opacity-40' : ''}`} />
                  {cd > 0 && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono-tabular font-bold text-white">
                      {cd.toFixed(0)}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Lower Ergonomic Action Cluster */}
        {atHelm ? (
          <div className="flex items-end gap-2.5 pointer-events-none">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleAnchor();
              }}
              className="pointer-events-auto touch-none-canvas w-12 h-12 rounded-full bg-slate-900/95 border border-sky-400/60 text-sky-200 flex flex-col items-center justify-center shadow-xl active:scale-95"
              aria-label={shipHud?.anchored ? 'Weigh Anchor' : 'Drop Anchor'}
            >
              <Anchor className="w-4 h-4" />
              <span className="text-[9px] font-semibold mt-0.5">{shipHud?.anchored ? 'Weigh' : 'Anchor'}</span>
            </button>

            <button
              type="button"
              disabled={(shipHud?.cannonCooldown ?? 0) > 0}
              onClick={(e) => {
                e.stopPropagation();
                onFireBroadside();
              }}
              className="pointer-events-auto touch-none-canvas w-16 h-16 rounded-full bg-amber-500 disabled:bg-slate-800 border-2 border-amber-200 text-slate-950 disabled:text-slate-300 flex flex-col items-center justify-center shadow-2xl active:scale-95"
              aria-label="Fire Broadside Cannons"
            >
              <Ship className="w-5 h-5" />
              <span className="text-[10px] font-bold mt-0.5">
                {(shipHud?.cannonCooldown ?? 0) > 0 ? `${shipHud?.cannonCooldown}s` : 'Fire'}
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 pointer-events-none">
            {/* Hold Crouch / Climb / Dive */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Ignore
                }
                setDiveHeld(true);
                onHoldState('dive', true);
                if (!isSwimming) onToggleCrouch();
              }}
              onPointerUp={() => {
                setDiveHeld(false);
                onHoldState('dive', false);
              }}
              onPointerCancel={() => {
                setDiveHeld(false);
                onHoldState('dive', false);
              }}
              onLostPointerCapture={() => {
                setDiveHeld(false);
                onHoldState('dive', false);
              }}
              aria-label={isSwimming ? 'Dive Deeper' : 'Crouch or Climb'}
              className={`pointer-events-auto touch-none-canvas w-11 h-11 rounded-full border flex flex-col items-center justify-center shadow-lg active:scale-95 ${
                diveHeld || isCrouching || isClimbing
                  ? 'bg-sky-500 text-slate-950 border-sky-300'
                  : 'bg-slate-900/90 text-slate-200 border-white/20'
              }`}
            >
              <ArrowDown className="w-4 h-4" />
              <span className="text-[8px] font-semibold leading-none mt-0.5">
                {isSwimming ? 'Dive' : 'Stealth'}
              </span>
            </button>

            {/* Hold Block */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Ignore
                }
                setBlockHeld(true);
                onHoldState('block', true);
              }}
              onPointerUp={() => {
                setBlockHeld(false);
                onHoldState('block', false);
              }}
              onPointerCancel={() => {
                setBlockHeld(false);
                onHoldState('block', false);
              }}
              onLostPointerCapture={() => {
                setBlockHeld(false);
                onHoldState('block', false);
              }}
              aria-label="Hold to Block"
              className={`pointer-events-auto touch-none-canvas w-11 h-11 rounded-full border flex flex-col items-center justify-center shadow-lg active:scale-95 ${
                blockHeld
                  ? 'bg-amber-500 text-slate-950 border-amber-300'
                  : 'bg-slate-900/90 text-slate-200 border-white/20'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span className="text-[8px] font-semibold leading-none mt-0.5">Block</span>
            </button>

            {/* Dodge Roll */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDodge();
              }}
              aria-label="Dodge Roll"
              className="pointer-events-auto touch-none-canvas w-12 h-12 rounded-full bg-slate-900/90 border border-emerald-400/50 text-emerald-300 flex flex-col items-center justify-center shadow-lg active:scale-95"
            >
              <Wind className="w-4 h-4" />
              <span className="text-[9px] font-semibold leading-none mt-0.5">Dodge</span>
            </button>

            {/* Jump / Swim-Up */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Ignore
                }
                setAscendHeld(true);
                onHoldState('ascend', true);
                onJump();
              }}
              onPointerUp={() => {
                setAscendHeld(false);
                onHoldState('ascend', false);
              }}
              onPointerCancel={() => {
                setAscendHeld(false);
                onHoldState('ascend', false);
              }}
              onLostPointerCapture={() => {
                setAscendHeld(false);
                onHoldState('ascend', false);
              }}
              aria-label={isSwimming ? 'Swim Up' : 'Jump'}
              className={`pointer-events-auto touch-none-canvas w-12 h-12 rounded-full border flex flex-col items-center justify-center shadow-lg active:scale-95 ${
                ascendHeld
                  ? 'bg-sky-400 text-slate-950 border-sky-200'
                  : 'bg-slate-900/90 text-slate-100 border-white/25'
              }`}
            >
              <ArrowUp className="w-4 h-4" />
              <span className="text-[9px] font-semibold leading-none mt-0.5">
                {isSwimming ? 'Up' : 'Jump'}
              </span>
            </button>

            {/* Primary Weapon Attack */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAttack();
              }}
              aria-label={primaryLabel}
              className="pointer-events-auto touch-none-canvas relative w-14 h-14 rounded-full bg-amber-500 border-2 border-amber-200 text-slate-950 flex flex-col items-center justify-center shadow-2xl active:scale-95"
            >
              <PrimaryWeaponIcon className="w-5 h-5" />
              <span className="text-[10px] font-bold leading-none mt-0.5">
                {cooldowns.melee > 0.05 ? `${cooldowns.melee.toFixed(1)}s` : primaryLabel}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
