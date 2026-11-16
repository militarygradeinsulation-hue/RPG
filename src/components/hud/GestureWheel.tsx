import React, { useRef, useState } from 'react';
import { Flame, Shield, Snowflake, Swords, Wind, Zap, Heart, Crosshair, X } from 'lucide-react';

export interface GestureCommand {
  id: string;
  label: string;
  minLevel: number;
  icon: React.ReactNode;
  color: string;
  action: () => void;
}

interface GestureWheelProps {
  open: boolean;
  playerLevel: number;
  onClose: () => void;
  onCommand: (cmdId: string) => void;
}

export const GestureWheel: React.FC<GestureWheelProps> = ({
  open,
  playerLevel,
  onClose,
  onCommand,
}) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!open) return null;

  const allCommands: GestureCommand[] = [
    { id: 'melee', label: 'Blade Strike', minLevel: 1, icon: <Swords className="w-4 h-4" />, color: '#e2e8f0', action: () => onCommand('melee') },
    { id: 'fire', label: 'Ember Nova', minLevel: 1, icon: <Flame className="w-4 h-4" />, color: '#f97316', action: () => onCommand('fire') },
    { id: 'lightning', label: 'Tempest Arc', minLevel: 1, icon: <Zap className="w-4 h-4" />, color: '#38bdf8', action: () => onCommand('lightning') },
    { id: 'frost', label: 'Glacial Surge', minLevel: 1, icon: <Snowflake className="w-4 h-4" />, color: '#67e8f9', action: () => onCommand('frost') },
    { id: 'gale', label: 'Zephyr Leap', minLevel: 2, icon: <Wind className="w-4 h-4" />, color: '#4ade80', action: () => onCommand('gale') },
    { id: 'companion_flank', label: 'Order Flank', minLevel: 2, icon: <Crosshair className="w-4 h-4" />, color: '#fbbf24', action: () => onCommand('companion_flank') },
    { id: 'companion_heal', label: 'Order Heal', minLevel: 3, icon: <Heart className="w-4 h-4" />, color: '#f472b6', action: () => onCommand('companion_heal') },
    { id: 'use_elixir', label: 'Drink Elixir', minLevel: 3, icon: <Shield className="w-4 h-4" />, color: '#c084fc', action: () => onCommand('use_elixir') },
  ];

  // Complexity automatically scales with player level (4 -> 6 -> 8 slots)
  const slotLimit = playerLevel >= 3 ? 8 : playerLevel >= 2 ? 6 : 4;
  const activeCommands = allCommands.slice(0, slotLimit);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 28) {
      setHoveredIdx(null);
      return;
    }
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const sector = Math.floor((angle / (Math.PI * 2)) * activeCommands.length) % activeCommands.length;
    setHoveredIdx(sector);
  };

  const handlePointerUp = () => {
    if (hoveredIdx !== null && activeCommands[hoveredIdx]) {
      activeCommands[hoveredIdx].action();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-label="Quick Tactical Gesture Menu"
      onClick={onClose}
    >
      <div
        ref={wheelRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerMove}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative w-72 h-72 sm:w-80 sm:h-80 rounded-full hud-modal flex items-center justify-center shadow-2xl touch-none-canvas"
      >
        <div className="text-center px-4 pointer-events-none">
          <div className="text-xs text-slate-400">Level {playerLevel} · {slotLimit} Slots</div>
          <div className="text-sm font-semibold text-amber-300 mt-1">
            {hoveredIdx !== null ? activeCommands[hoveredIdx].label : 'Swipe or Click'}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close tactical wheel"
          className="absolute bottom-3 right-3 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          <X className="w-4 h-4" />
        </button>

        {activeCommands.map((cmd, idx) => {
          const angle = (idx / activeCommands.length) * Math.PI * 2 - Math.PI / 2;
          const radius = 112;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const active = hoveredIdx === idx;

          return (
            <button
              key={cmd.id}
              type="button"
              onMouseEnter={() => setHoveredIdx(idx)}
              onClick={() => {
                cmd.action();
                onClose();
              }}
              style={{
                transform: `translate(${x}px, ${y}px) scale(${active ? 1.1 : 1})`,
                borderColor: active ? cmd.color : 'rgba(255,255,255,0.16)',
              }}
              className="absolute w-20 h-14 rounded-lg bg-slate-900 border flex flex-col items-center justify-center gap-1 text-xs font-medium transition-transform focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              <span style={{ color: cmd.color }}>{cmd.icon}</span>
              <span className="truncate max-w-[74px] text-[11px] text-slate-100">{cmd.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
