import React from 'react';
import { Anchor, Compass, Flame, MapPin, Shield, Ship, Skull } from 'lucide-react';
import { CompassMarker } from '../../types/game';

const CARDINALS: ReadonlyArray<{ label: string; dirX: number; dirZ: number; major: boolean }> = [
  { label: 'N', dirX: 0, dirZ: -1, major: true },
  { label: 'NE', dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2, major: false },
  { label: 'E', dirX: 1, dirZ: 0, major: true },
  { label: 'SE', dirX: Math.SQRT1_2, dirZ: Math.SQRT1_2, major: false },
  { label: 'S', dirX: 0, dirZ: 1, major: true },
  { label: 'SW', dirX: -Math.SQRT1_2, dirZ: Math.SQRT1_2, major: false },
  { label: 'W', dirX: -1, dirZ: 0, major: true },
  { label: 'NW', dirX: -Math.SQRT1_2, dirZ: -Math.SQRT1_2, major: false },
];

const FOV_HALF_RAD = (85 * Math.PI) / 180;

export interface CompassBarWithCoordsProps {
  cameraYaw: number;
  playerX: number;
  playerZ: number;
  markers: CompassMarker[];
  currentLocationLabel: string;
}

export const HorizonCompassBar: React.FC<CompassBarWithCoordsProps> = ({
  cameraYaw,
  playerX,
  playerZ,
  markers,
  currentLocationLabel,
}) => {
  const fwdX = -Math.sin(cameraYaw);
  const fwdZ = -Math.cos(cameraYaw);
  const rightX = Math.cos(cameraYaw);
  const rightZ = -Math.sin(cameraYaw);

  const projectDir = (dirX: number, dirZ: number): number | null => {
    const fDot = dirX * fwdX + dirZ * fwdZ;
    const rDot = dirX * rightX + dirZ * rightZ;
    const rel = Math.atan2(rDot, fDot);
    if (Math.abs(rel) > FOV_HALF_RAD) return null;
    return 50 + (rel / FOV_HALF_RAD) * 46;
  };

  const renderMarkerIcon = (kind: CompassMarker['kind'], color: string) => {
    const cls = 'w-3 h-3 shrink-0';
    switch (kind) {
      case 'harbor':
        return <Anchor className={cls} style={{ color }} />;
      case 'ship':
        return <Ship className={cls} style={{ color }} />;
      case 'dragon':
        return <Flame className={cls} style={{ color }} />;
      case 'town':
        return <Shield className={cls} style={{ color }} />;
      case 'dungeon':
        return <Skull className={cls} style={{ color }} />;
      case 'seal':
        return <Compass className={cls} style={{ color }} />;
      default:
        return <MapPin className={cls} style={{ color }} />;
    }
  };

  const projectedMarkers = markers
    .map((m) => {
      const dx = m.x - playerX;
      const dz = m.z - playerZ;
      const d = Math.hypot(dx, dz);
      if (d < 4) return null;
      const pct = projectDir(dx / d, dz / d);
      if (pct === null) return null;
      return { ...m, pct, distance: Math.round(d) };
    })
    .filter((v): v is CompassMarker & { pct: number } => Boolean(v))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

  return (
    <div className="hidden md:flex fixed top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none flex-col items-center gap-1 w-[340px] lg:w-[440px]">
      <div className="relative w-full h-8 rounded-lg hud-panel overflow-hidden shadow-lg border border-white/15">
        {/* Center Reticle */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-400/50 -translate-x-1/2" />
        <div className="absolute left-1/2 top-0 -translate-x-1/2 w-1.5 h-1 bg-amber-300 rounded-b" />

        {/* Cardinal Bearings */}
        {CARDINALS.map((c) => {
          const pct = projectDir(c.dirX, c.dirZ);
          if (pct === null) return null;
          return (
            <div
              key={c.label}
              style={{ left: `${pct}%` }}
              className="absolute top-1 -translate-x-1/2 flex flex-col items-center"
            >
              <span
                className={
                  c.major
                    ? 'text-[10px] font-display font-bold text-amber-200 leading-none'
                    : 'text-[9px] font-mono-tabular text-slate-400 leading-none'
                }
              >
                {c.label}
              </span>
            </div>
          );
        })}

        {/* Projected Landmarks / Objectives */}
        {projectedMarkers.map((m) => (
          <div
            key={m.id}
            style={{ left: `${m.pct}%` }}
            className="absolute bottom-0.5 -translate-x-1/2 flex items-center gap-0.5 px-1 rounded bg-slate-950/70"
            title={`${m.label} (${m.distance}m)`}
          >
            {renderMarkerIcon(m.kind, m.color)}
            {m.distance < 320 && (
              <span className="text-[9px] font-mono-tabular text-slate-200 leading-none">
                {m.distance}m
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="px-2.5 py-0.5 rounded bg-slate-950/65 border border-white/10 text-[10px] font-medium text-amber-100/85 tracking-wide">
        {currentLocationLabel}
      </div>
    </div>
  );
};
