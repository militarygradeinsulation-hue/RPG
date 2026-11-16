import React, { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { getBiomeAt, groundHeightAt, WATER_LEVEL } from '../../engine/terrain';
import { BiomeId, BiomeState, DungeonZoneInfo, MiniMapEntity } from '../../types/game';

interface MiniMapProps {
  playerX: number;
  playerZ: number;
  cameraYaw: number;
  entities: MiniMapEntity[];
  activeDungeon: DungeonZoneInfo | null;
  biomes: Record<BiomeId, BiomeState>;
  currentBiome: BiomeId;
  onOpenAtlas: () => void;
}

const SIZE = 156;
const HALF = SIZE / 2;

const BIOME_COLORS: Record<BiomeId, { land: [number, number, number]; high: [number, number, number] }> = {
  suncrest: { land: [96, 114, 72], high: [152, 146, 108] },
  verdant: { land: [42, 104, 68], high: [74, 142, 92] },
  ember: { land: [108, 62, 46], high: [148, 88, 60] },
  aether: { land: [72, 82, 128], high: [122, 134, 184] },
};

export const MiniMap: React.FC<MiniMapProps> = ({
  playerX,
  playerZ,
  cameraYaw,
  entities,
  activeDungeon,
  biomes,
  currentBiome,
  onOpenAtlas,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCacheRef = useRef<{
    x: number;
    z: number;
    radius: number;
    biomeHealthSig: string;
    dungeonId: string | null;
    imageData: ImageData | null;
  }>({ x: 99999, z: 99999, radius: 0, biomeHealthSig: '', dungeonId: null, imageData: null });

  const [wideZoom, setWideZoom] = useState(false);
  const radarRadius = activeDungeon ? 38 : wideZoom ? 130 : 68;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const biomeHealthSig = `${Math.round(biomes.suncrest.health)}_${Math.round(biomes.verdant.health)}_${Math.round(biomes.ember.health)}_${Math.round(biomes.aether.health)}`;
    const cache = terrainCacheRef.current;
    const dungeonId = activeDungeon?.id || null;

    const movedEnough = Math.hypot(playerX - cache.x, playerZ - cache.z) > (wideZoom ? 2.5 : 1.2);
    const needsTerrainRedraw =
      !cache.imageData ||
      movedEnough ||
      cache.radius !== radarRadius ||
      cache.biomeHealthSig !== biomeHealthSig ||
      cache.dungeonId !== dungeonId;

    if (needsTerrainRedraw) {
      const img = ctx.createImageData(SIZE, SIZE);
      const data = img.data;

      if (activeDungeon) {
        // Render subterranean cavern walls & sanctuary floor
        for (let py = 0; py < SIZE; py++) {
          for (let px = 0; px < SIZE; px++) {
            const wx = playerX + ((px - HALF) / HALF) * radarRadius;
            const wz = playerZ + ((py - HALF) / HALF) * radarRadius;
            const inMainHall = wx >= -19.5 && wx <= 19.5 && wz >= -45.5 && wz <= 14.0;
            const inBossAlcove = Math.hypot(wx, wz + 34) < 12;
            const idx = (py * SIZE + px) * 4;

            if (inMainHall || inBossAlcove) {
              const nearWall =
                !inBossAlcove &&
                (Math.abs(Math.abs(wx) - 19.5) < 1.1 || wz > 12.9 || wz < -44.4);
              if (nearWall) {
                data[idx] = 74;
                data[idx + 1] = 82;
                data[idx + 2] = 104;
              } else {
                const checker = ((Math.floor(wx / 4) + Math.floor(wz / 4)) & 1) === 0 ? 4 : 0;
                data[idx] = 28 + checker;
                data[idx + 1] = 32 + checker;
                data[idx + 2] = 46 + checker;
              }
            } else {
              // Solid bedrock
              data[idx] = 10;
              data[idx + 1] = 12;
              data[idx + 2] = 20;
            }
            data[idx + 3] = 255;
          }
        }
      } else {
        // Sample real-time overworld procedural terrain at 2px blocks for razor-sharp 60fps updates
        const step = 2;
        for (let py = 0; py < SIZE; py += step) {
          for (let px = 0; px < SIZE; px += step) {
            const wx = playerX + ((px - HALF) / HALF) * radarRadius;
            const wz = playerZ + ((py - HALF) / HALF) * radarRadius;
            const h = groundHeightAt(wx, wz);
            const b = getBiomeAt(wx, wz);
            const bHealth = (biomes[b]?.health ?? 50) / 100;

            let r = 0;
            let g = 0;
            let bl = 0;

            if (h < WATER_LEVEL) {
              const depth = Math.min(1, (WATER_LEVEL - h) * 0.45);
              r = Math.round(28 - depth * 12);
              g = Math.round(86 - depth * 28);
              bl = Math.round(142 - depth * 34);
            } else {
              const pal = BIOME_COLORS[b];
              const elev = Math.min(1, Math.max(0, (h - WATER_LEVEL) / 10));
              // Blend toward blighted violet-slate when biome health is low
              const healthyR = pal.land[0] + (pal.high[0] - pal.land[0]) * elev;
              const healthyG = pal.land[1] + (pal.high[1] - pal.land[1]) * elev;
              const healthyB = pal.land[2] + (pal.high[2] - pal.land[2]) * elev;

              const blightR = 54 + elev * 24;
              const blightG = 42 + elev * 18;
              const blightB = 74 + elev * 28;

              const blend = 0.25 + bHealth * 0.75;
              r = Math.round(blightR + (healthyR - blightR) * blend);
              g = Math.round(blightG + (healthyG - blightG) * blend);
              bl = Math.round(blightB + (healthyB - blightB) * blend);

              // Topographic contour lines every 2.2m
              if (Math.abs((h * 1.4) % 3) < 0.2) {
                r = Math.min(255, r + 14);
                g = Math.min(255, g + 14);
                bl = Math.min(255, bl + 12);
              }
            }

            for (let dy = 0; dy < step && py + dy < SIZE; dy++) {
              for (let dx = 0; dx < step && px + dx < SIZE; dx++) {
                const idx = ((py + dy) * SIZE + (px + dx)) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = bl;
                data[idx + 3] = 255;
              }
            }
          }
        }
      }

      cache.x = playerX;
      cache.z = playerZ;
      cache.radius = radarRadius;
      cache.biomeHealthSig = biomeHealthSig;
      cache.dungeonId = dungeonId;
      cache.imageData = img;
    }

    if (cache.imageData) {
      ctx.putImageData(cache.imageData, 0, 0);
    }

    // Subtle radar range rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF * 0.94, 0, Math.PI * 2);
    ctx.stroke();

    // Draw entities & off-radar objective pointers
    entities.forEach((e) => {
      const dx = e.x - playerX;
      const dz = e.z - playerZ;
      const sx = HALF + (dx / radarRadius) * HALF;
      const sy = HALF + (dz / radarRadius) * HALF;
      const distFromCenter = Math.hypot(sx - HALF, sy - HALF);

      const isImportant =
        (e.kind === 'seal' && e.color !== '#34d399') ||
        e.kind === 'dungeon' ||
        e.kind === 'chest' ||
        e.kind === 'ship' ||
        e.kind === 'harbor';

      if (distFromCenter > HALF - 7) {
        if (isImportant) {
          // Edge compass chevron pointing toward active quest objective, ship, harbor, or dungeon portal
          const ang = Math.atan2(sy - HALF, sx - HALF);
          const edgeR = HALF - 6;
          const ex = HALF + Math.cos(ang) * edgeR;
          const ey = HALF + Math.sin(ang) * edgeR;

          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.moveTo(4.5, 0);
          ctx.lineTo(-3, -3.2);
          ctx.lineTo(-3, 3.2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        return;
      }

      ctx.save();
      ctx.translate(sx, sy);
      ctx.fillStyle = e.color;
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1;

      if (e.kind === 'seal') {
        // Diamond shrine marker
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(4.5, 0);
        ctx.lineTo(0, 5);
        ctx.lineTo(-4.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.kind === 'ship') {
        // Vessel hull icon
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(3.5, 0);
        ctx.lineTo(2.5, 4.5);
        ctx.lineTo(-2.5, 4.5);
        ctx.lineTo(-3.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.kind === 'harbor') {
        // Harbor pier & anchor ring
        ctx.beginPath();
        ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#090d16';
        ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
      } else if (e.kind === 'dungeon') {
        // Square cave portal
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.strokeRect(-3.5, -3.5, 7, 7);
      } else if (e.kind === 'dragon') {
        // Winged triangle for Dragons
        ctx.beginPath();
        ctx.moveTo(0, -5.5);
        ctx.lineTo(5, 4);
        ctx.lineTo(0, 1.8);
        ctx.lineTo(-5, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.kind === 'chest') {
        ctx.fillRect(-3, -2.5, 6, 5);
        ctx.strokeRect(-3, -2.5, 6, 5);
      } else {
        const r = e.kind === 'npc' || e.kind === 'enemy' ? 2.7 : 2.1;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        if (e.kind === 'npc' || e.kind === 'enemy') ctx.stroke();
      }
      ctx.restore();
    });

    // Player view cone & directional arrow
    ctx.save();
    ctx.translate(HALF, HALF);
    ctx.rotate(-cameraYaw);

    const coneGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    coneGrad.addColorStop(0, 'rgba(251, 191, 36, 0.32)');
    coneGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 26, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [playerX, playerZ, cameraYaw, entities, activeDungeon, biomes, radarRadius, wideZoom]);

  const zoneTitle = activeDungeon ? activeDungeon.name : biomes[currentBiome]?.name || 'Suncrest';

  return (
    <div className="w-[172px] rounded-xl hud-panel p-2 shadow-xl space-y-1.5 select-none">
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className="text-[11px] font-semibold text-amber-200 truncate" title={zoneTitle}>
          {zoneTitle}
        </span>
        {!activeDungeon && (
          <button
            type="button"
            onClick={() => setWideZoom((z) => !z)}
            className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0"
            title="Toggle Radar Zoom"
          >
            {wideZoom ? '2x' : '1x'}
          </button>
        )}
      </div>

      <div className="relative w-[156px] h-[156px] rounded-lg overflow-hidden border border-white/15 bg-slate-950">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="w-full h-full block" />
        <div className="absolute top-1 left-1/2 -translate-x-1/2 px-1 rounded bg-slate-950/85 text-[9px] font-bold text-amber-300 tracking-wider pointer-events-none">
          N
        </div>
        <button
          type="button"
          onClick={onOpenAtlas}
          aria-label="Open World Atlas"
          title="Open World Atlas"
          className="absolute bottom-1 right-1 p-1 rounded bg-slate-950/85 hover:bg-slate-800 border border-white/15 text-emerald-300"
        >
          <Compass className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono-tabular px-0.5">
        <span>
          {Math.round(playerX)}, {Math.round(playerZ)}
        </span>
        <span className="flex items-center gap-1.5 text-[9px]">
          <span className="inline-flex items-center gap-0.5 text-purple-300">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
            Seal
          </span>
          <span className="inline-flex items-center gap-0.5 text-orange-300">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
            Wyrm
          </span>
        </span>
      </div>
    </div>
  );
};
