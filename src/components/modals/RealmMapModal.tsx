import React, { useEffect, useRef, useState } from 'react';
import { Anchor, Compass, Globe, Map as MapIcon, MapPin, Navigation, X } from 'lucide-react';
import { getBiomeAt, groundHeightAt, WATER_LEVEL } from '../../engine/terrain';
import { WORLD_POIS } from '../../world/ocean/ArchipelagoGen';
import { BiomeId, BiomeState } from '../../types/game';

interface BiomeRegionLore {
  biomeId: BiomeId;
  title: string;
  coords3d: { x: number; z: number };
  pinColor: string;
  loreNote: string;
  climateNote: string;
}

const BIOME_REGIONS: BiomeRegionLore[] = [
  {
    biomeId: 'suncrest',
    title: 'Suncrest Citadel',
    coords3d: { x: 0, z: 6 },
    pinColor: '#f59e0b',
    loreNote: 'Tidal stone ramparts and the sacred hilltop shrine of the Four Seals overlooking the southern bay.',
    climateNote: 'Sub-alpine plateau · Clear moonlit skies & cold coastal breezes',
  },
  {
    biomeId: 'verdant',
    title: 'Verdant Vale',
    coords3d: { x: -50, z: 32 },
    pinColor: '#10b981',
    loreNote: 'Moss-draped ancient canopies, river valleys, and timber settlements guarded by the Verdant Circle.',
    climateNote: 'Temperate river basin · High windward precipitation & lush flora',
  },
  {
    biomeId: 'ember',
    title: 'Ember Crag',
    coords3d: { x: 56, z: 38 },
    pinColor: '#f97316',
    loreNote: 'Basalt ridges, volcanic gorges, and Ironbound smithing bastions forged above magma vents.',
    climateNote: 'Rain-shadow volcanic highlands · Thermal updrafts & ashfall',
  },
  {
    biomeId: 'aether',
    title: 'Aether Spire',
    coords3d: { x: 0, z: -74 },
    pinColor: '#38bdf8',
    loreNote: 'Glacial peaks and the crystal lake moat where high-altitude storms converge.',
    climateNote: 'Glacial alpine ridge · Sub-zero blizzards & aurora resonance',
  },
];

interface RealmMapModalProps {
  open: boolean;
  biomes: Record<BiomeId, BiomeState>;
  playerX?: number;
  playerZ?: number;
  onClose: () => void;
  onFastTravel: (x: number, z: number, label: string) => void;
}

const BIOME_PALETTE: Record<BiomeId, [number, number, number]> = {
  suncrest: [142, 148, 112],
  verdant: [62, 126, 78],
  ember: [134, 76, 56],
  aether: [110, 134, 178],
};

export const RealmMapModal: React.FC<RealmMapModalProps> = ({
  open,
  biomes,
  playerX = 0,
  playerZ = 6,
  onClose,
  onFastTravel,
}) => {
  const [chartStyle, setChartStyle] = useState<'nautical' | 'parchment'>('nautical');
  const [selectedRegion, setSelectedRegion] = useState<BiomeRegionLore>(BIOME_REGIONS[0]);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  const minX = -240;
  const maxX = 240;
  const minZ = -140;
  const maxZ = 280;

  // Render interactive Aethelgard & Archipelago Sea Chart (Nautical or Ancient Parchment style)
  useEffect(() => {
    if (!open) return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    const img = ctx.createImageData(W, H);
    const data = img.data;
    const isParchment = chartStyle === 'parchment';

    for (let py = 0; py < H; py += 2) {
      const wz = minZ + (py / H) * (maxZ - minZ);
      for (let px = 0; px < W; px += 2) {
        const wx = minX + (px / W) * (maxX - minX);
        const h = groundHeightAt(wx, wz);
        const b = getBiomeAt(wx, wz);

        let r = 0;
        let g = 0;
        let bl = 0;
        if (h < WATER_LEVEL) {
          const depth = Math.min(1, (WATER_LEVEL - h) * 0.14);
          if (isParchment) {
            const coast = Math.abs(h - WATER_LEVEL) < 1.2 ? -24 : 0;
            r = Math.round(188 - depth * 32 + coast);
            g = Math.round(172 - depth * 30 + coast);
            bl = Math.round(138 - depth * 28 + coast);
          } else {
            r = Math.round(28 - depth * 16);
            g = Math.round(74 - depth * 36);
            bl = Math.round(118 - depth * 42);
          }
        } else {
          const elev = Math.min(1, h / 22);
          if (isParchment) {
            const shade = Math.round(elev * 36);
            r = Math.min(255, 218 - shade);
            g = Math.min(255, 198 - shade);
            bl = Math.min(255, 154 - shade);
            if (Math.abs((h * 1.2) % 3) < 0.28) {
              r -= 28;
              g -= 28;
              bl -= 24;
            }
          } else {
            const pal = BIOME_PALETTE[b];
            r = Math.min(255, Math.round(pal[0] + elev * 68));
            g = Math.min(255, Math.round(pal[1] + elev * 64));
            bl = Math.min(255, Math.round(pal[2] + elev * 68));
            if (Math.abs((h * 1.2) % 3) < 0.25) {
              r = Math.max(0, r - 18);
              g = Math.max(0, g - 18);
              bl = Math.max(0, bl - 16);
            }
          }
        }
        for (let dy = 0; dy < 2 && py + dy < H; dy++) {
          for (let dx = 0; dx < 2 && px + dx < W; dx++) {
            const idx = ((py + dy) * W + (px + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = bl;
            data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // Subtle nautical rhumb / grid lines
    ctx.strokeStyle = isParchment ? 'rgba(68, 48, 24, 0.16)' : 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const toScreen = (wx: number, wz: number) => ({
      sx: ((wx - minX) / (maxX - minX)) * W,
      sy: ((wz - minZ) / (maxZ - minZ)) * H,
    });

    // Plot POIs
    ctx.font = 'bold 11px Inter, sans-serif';
    WORLD_POIS.forEach((poi) => {
      const { sx, sy } = toScreen(poi.x, poi.z);
      ctx.fillStyle = poi.kind === 'harbor' ? '#38bdf8' : poi.kind === 'capital' ? '#fbbf24' : '#cbd5e1';
      ctx.strokeStyle = isParchment ? '#291d12' : '#090d16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, poi.kind === 'capital' ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isParchment ? '#291d12' : '#f8fafc';
      ctx.fillText(poi.name, sx + 8, sy + 4);
    });

    // Plot Player Marker
    const ps = toScreen(playerX, playerZ);
    ctx.fillStyle = '#10b981';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ps.sx, ps.sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isParchment ? '#065f46' : '#6ee7b7';
    ctx.fillText('You', ps.sx + 8, ps.sy + 4);
  }, [open, chartStyle, playerX, playerZ, minX, maxX, minZ, maxZ]);

  if (!open) return null;

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const wx = Math.round(minX + u * (maxX - minX));
    const wz = Math.round(minZ + v * (maxZ - minZ));

    // Snap to nearest POI if clicked within 18m, else travel directly to clicked coordinates
    let nearestPoi = WORLD_POIS[0];
    let bestDist = Infinity;
    for (const poi of WORLD_POIS) {
      const d = Math.hypot(poi.x - wx, poi.z - wz);
      if (d < bestDist) {
        bestDist = d;
        nearestPoi = poi;
      }
    }
    if (bestDist <= 18 && nearestPoi) {
      onFastTravel(nearestPoi.x, nearestPoi.z, nearestPoi.name);
    } else {
      onFastTravel(wx, wz, `Chart Coordinates (${wx}, ${wz})`);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label="World Atlas and Sea Chart"
    >
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-amber-300" />
            <div>
              <h2 className="font-display text-xl font-bold text-amber-300">World Atlas & Nautical Chart</h2>
              <p className="text-xs text-slate-400">
                Click any landmark or point on the chart to fast-travel across Aethelgard’s regions and archipelago
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChartStyle('nautical')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                chartStyle === 'nautical'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Topographic Sea Chart
            </button>
            <button
              type="button"
              onClick={() => setChartStyle('parchment')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                chartStyle === 'parchment'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              Ancient Parchment Map
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close world atlas"
              className="p-2 rounded-lg hover:bg-white/10 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <div className="rounded-xl overflow-hidden border border-white/15 bg-slate-950 relative">
                <canvas
                  ref={chartCanvasRef}
                  width={640}
                  height={420}
                  onClick={handleCanvasClick}
                  className="w-full h-auto block cursor-crosshair"
                  title="Click anywhere on the map to fast-travel"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BIOME_REGIONS.map((reg) => {
                  const health = Math.round(biomes[reg.biomeId]?.health ?? 50);
                  const active = selectedRegion.biomeId === reg.biomeId;
                  return (
                    <button
                      key={reg.biomeId}
                      type="button"
                      onClick={() => setSelectedRegion(reg)}
                      className={`text-left p-2.5 rounded-lg border transition-colors ${
                        active
                          ? 'bg-amber-500/15 border-amber-400'
                          : 'bg-slate-900/75 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-amber-300 shrink-0" />
                          {reg.title}
                        </span>
                        <span className="text-[10px] font-mono-tabular text-emerald-300">{health}%</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">{reg.climateNote}</div>
                    </button>
                  );
                })}
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-amber-300">{selectedRegion.title}</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{selectedRegion.loreNote}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onFastTravel(selectedRegion.coords3d.x, selectedRegion.coords3d.z, selectedRegion.title);
                    onClose();
                  }}
                  className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0 flex items-center gap-1.5"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  Travel to {selectedRegion.title}
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Fast Travel Waypoints
              </div>
              {WORLD_POIS.map((poi) => (
                <button
                  key={poi.id}
                  type="button"
                  onClick={() => {
                    onFastTravel(poi.x, poi.z, poi.name);
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-white/10 flex items-center justify-between gap-2 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {poi.kind === 'harbor' ? (
                      <Anchor className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    ) : (
                      <Navigation className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    )}
                    <div className="truncate">
                      <div className="text-xs font-semibold text-white truncate">{poi.name}</div>
                      <div className="text-[10px] text-slate-400 capitalize">
                        {poi.kind} · {poi.biomeId}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono-tabular text-amber-300 shrink-0">Travel</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
