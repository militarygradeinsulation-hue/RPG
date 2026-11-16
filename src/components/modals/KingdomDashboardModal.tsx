import React, { useState } from 'react';
import { Hammer, Map, Network, Shield, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ITEMS } from '../../data/worldData';
import {
  BiomeId,
  BiomeState,
  FactionId,
  FactionState,
  InventoryItem,
  NpcState,
  OutpostState,
  TradeRouteState,
} from '../../types/game';

interface KingdomDashboardModalProps {
  open: boolean;
  initialTab?: 'factions' | 'economy' | 'outposts' | 'relationships';
  biomes: Record<BiomeId, BiomeState>;
  factions: Record<FactionId, FactionState>;
  tradeRoutes: TradeRouteState[];
  outposts: OutpostState[];
  npcs: NpcState[];
  inventory: InventoryItem[];
  gold: number;
  onClose: () => void;
  onSabotageRoute: (routeId: string) => void;
  onRestoreRoute: (routeId: string) => void;
  onBuildOutpost: (outpostId: string) => void;
  onInfluenceNpc: (npcId: string) => void;
  onFastTravel: (x: number, z: number, label: string) => void;
}

export function getVendorPriceMultiplier(reputation: number): number {
  // Reputation -100..+100 -> +45% markup to -25% discount
  if (reputation >= 50) return 0.75;
  if (reputation >= 20) return 0.88;
  if (reputation >= -10) return 1.0;
  if (reputation >= -40) return 1.2;
  return 1.45;
}

export const KingdomDashboardModal: React.FC<KingdomDashboardModalProps> = ({
  open,
  initialTab = 'factions',
  biomes,
  factions,
  tradeRoutes,
  outposts,
  npcs,
  inventory,
  gold,
  onClose,
  onSabotageRoute,
  onRestoreRoute,
  onBuildOutpost,
  onInfluenceNpc,
  onFastTravel,
}) => {
  const [tab, setTab] = useState<'factions' | 'economy' | 'outposts' | 'relationships'>(initialTab);
  const [selectedNpcId, setSelectedNpcId] = useState<string>(npcs[0]?.id || 'npc_rowan');

  if (!open) return null;

  const selectedNpc = npcs.find((n) => n.id === selectedNpcId) || npcs[0];

  const mapToSvg = (x: number, z: number) => ({
    sx: ((x + 95) / 190) * 380 + 20,
    sy: ((z + 95) / 190) * 240 + 20,
  });

  const graphPositions: Record<string, { x: number; y: number }> = {
    npc_rowan: { x: 210, y: 65 },
    npc_elara: { x: 105, y: 120 },
    npc_lyra: { x: 95, y: 215 },
    npc_thorin: { x: 230, y: 225 },
    npc_marcus: { x: 345, y: 175 },
    npc_vespera: { x: 325, y: 75 },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Kingdom Strategy, Economy, Outposts, and Social Graph"
    >
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-display text-xl font-bold text-amber-300">Realm Overview</h2>
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setTab('factions')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${
                  tab === 'factions' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                Factions & Biomes
              </button>
              <button
                type="button"
                onClick={() => setTab('economy')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${
                  tab === 'economy' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Map className="w-3.5 h-3.5" />
                Economy & Trade
              </button>
              <button
                type="button"
                onClick={() => setTab('outposts')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${
                  tab === 'outposts' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Hammer className="w-3.5 h-3.5" />
                Outposts
              </button>
              <button
                type="button"
                onClick={() => setTab('relationships')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${
                  tab === 'relationships' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                Relationship Graph
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close realm overview" className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'factions' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Faction Reputation & Dynamic Vendor Pricing</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.values(factions).map((f) => {
                    const mult = getVendorPriceMultiplier(f.reputation);
                    const pct = Math.round((mult - 1) * 100);
                    return (
                      <div key={f.id} className="p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-white">{f.name}</span>
                          <span className="font-mono-tabular text-xs text-amber-300">{f.reputation > 0 ? `+${f.reputation}` : f.reputation} Rep</span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-amber-400"
                            style={{ width: `${((f.reputation + 100) / 200) * 100}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-slate-300">
                            Vendor Pricing:{' '}
                            <strong className={pct <= 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {pct === 0 ? 'Standard (0%)' : pct < 0 ? `${pct}% Discount` : `+${pct}% Markup`}
                            </strong>
                          </span>
                          <span className="text-slate-400 font-mono-tabular">Corruption {f.corruptInfluence}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Biome Health & Fast Travel</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.values(biomes).map((b) => (
                    <div key={b.id} className="p-4 rounded-xl bg-slate-900/80 border border-white/10 flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{b.name}</span>
                          <span className="font-mono-tabular text-xs text-emerald-400">{Math.round(b.health)}% Healthy</span>
                        </div>
                        <p className="text-xs text-slate-400">{b.health >= 60 ? b.restoredDescription : b.corruptionDescription}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onFastTravel(b.center.x, b.center.z + 10, b.name);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 whitespace-nowrap shrink-0"
                      >
                        Travel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'economy' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900 border border-white/10">
                <h3 className="text-sm font-semibold text-amber-300 mb-2">Live Trade Route Map</h3>
                <svg viewBox="0 0 420 280" className="w-full h-64 rounded-lg bg-[#0b1220] border border-white/10">
                  {tradeRoutes.map((route) => {
                    const p1 = mapToSvg(route.fromCoord.x, route.fromCoord.z);
                    const p2 = mapToSvg(route.toCoord.x, route.toCoord.z);
                    const cx = p1.sx + (p2.sx - p1.sx) * route.progress;
                    const cy = p1.sy + (p2.sy - p1.sy) * route.progress;
                    return (
                      <g key={route.id}>
                        <line
                          x1={p1.sx}
                          y1={p1.sy}
                          x2={p2.sx}
                          y2={p2.sy}
                          stroke={route.sabotaged ? '#ef4444' : '#f59e0b'}
                          strokeWidth="2.5"
                          strokeDasharray={route.sabotaged ? '5 4' : undefined}
                        />
                        <circle cx={cx} cy={cy} r="5" fill={route.sabotaged ? '#fca5a5' : '#fde047'} />
                      </g>
                    );
                  })}
                  {Object.values(biomes).map((b) => {
                    const pt = mapToSvg(b.center.x, b.center.z);
                    return (
                      <g key={b.id}>
                        <circle cx={pt.sx} cy={pt.sy} r="10" fill="#1e293b" stroke="#38bdf8" strokeWidth="2" />
                        <text x={pt.sx} y={pt.sy + 21} textAnchor="middle" fill="#cbd5e1" fontSize="10" fontWeight="600">
                          {b.name}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <p className="text-xs text-slate-400 mt-2">
                  Sabotaging corrupt supply lines weakens hostile faction influence and grants intercepted supplies; restoring allied routes boosts biome commerce.
                </p>
              </div>

              <div className="lg:col-span-6 space-y-3">
                {tradeRoutes.map((route) => (
                  <div key={route.id} className="p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-white">{route.name}</span>
                      <span className="font-mono-tabular text-xs text-amber-300">{route.goodsValue}g Value</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {route.fromName} → {route.toName} · Route Health {route.health}% ·{' '}
                      <span className={route.sabotaged ? 'text-red-400' : 'text-emerald-400'}>
                        {route.sabotaged ? 'Disrupted' : 'Active Caravan'}
                      </span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      {!route.sabotaged ? (
                        <button
                          type="button"
                          onClick={() => onSabotageRoute(route.id)}
                          className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800/80 border border-red-400/30 text-xs font-semibold text-red-200 flex items-center gap-1.5"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Sabotage Route
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRestoreRoute(route.id)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-400/30 text-xs font-semibold text-emerald-200 flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Restore Caravan
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'outposts' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {outposts.map((op) => {
                const canAfford = op.requiredMaterials.every(
                  (req) => (inventory.find((i) => i.id === req.itemId)?.qty || 0) >= req.qty * (op.level + 1)
                );
                return (
                  <div key={op.id} className="p-4 rounded-xl bg-slate-900/90 border border-white/10 flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-sm text-white">{op.name}</h3>
                        <span className="font-mono-tabular text-xs text-amber-300">Tier {op.level}/2</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Biome: {biomes[op.biomeId].name} · Defense +{op.defenseBonus * Math.max(1, op.level)}
                      </div>
                      <div className="text-xs text-emerald-300">
                        Unlocks Merchant Stock: {op.unlockedStock.map((id) => ITEMS[id]?.name).join(', ')}
                      </div>
                      {op.level < 2 && (
                        <div className="pt-2 border-t border-white/10 space-y-1">
                          <div className="text-xs font-semibold text-slate-300">Required Materials:</div>
                          {op.requiredMaterials.map((req) => {
                            const need = req.qty * (op.level + 1);
                            const have = inventory.find((i) => i.id === req.itemId)?.qty || 0;
                            return (
                              <div key={req.itemId} className="flex justify-between text-xs font-mono-tabular">
                                <span className="text-slate-300">{ITEMS[req.itemId]?.name}</span>
                                <span className={have >= need ? 'text-emerald-400' : 'text-red-400'}>
                                  {have}/{need}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={op.level >= 2 || !canAfford}
                        onClick={() => onBuildOutpost(op.id)}
                        className="flex-1 py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-semibold"
                      >
                        {op.level >= 2 ? 'Fortified' : op.level === 0 ? 'Rebuild Outpost' : 'Upgrade Tier 2'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onFastTravel(op.x, op.z + 6, op.name);
                          onClose();
                        }}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
                      >
                        Visit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'relationships' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 p-4 rounded-xl bg-slate-900 border border-white/10">
                <h3 className="text-sm font-semibold text-amber-300 mb-2">Social Connection Graph</h3>
                <svg viewBox="0 0 430 280" className="w-full h-64 rounded-lg bg-[#0b1220] border border-white/10">
                  {npcs.map((n) =>
                    n.relationships.map((rel) => {
                      const p1 = graphPositions[n.id];
                      const p2 = graphPositions[rel.targetId];
                      if (!p1 || !p2 || n.id > rel.targetId) return null;
                      return (
                        <line
                          key={`${n.id}-${rel.targetId}`}
                          x1={p1.x}
                          y1={p1.y}
                          x2={p2.x}
                          y2={p2.y}
                          stroke={rel.type === 'Rival' ? '#ef4444' : rel.type === 'Mentor' ? '#fbbf24' : '#34d399'}
                          strokeWidth="2"
                          strokeDasharray={rel.type === 'Rival' ? '4 4' : undefined}
                        />
                      );
                    })
                  )}
                  {npcs.map((n) => {
                    const pos = graphPositions[n.id];
                    if (!pos) return null;
                    const active = selectedNpc.id === n.id;
                    return (
                      <g key={n.id} onClick={() => setSelectedNpcId(n.id)} className="cursor-pointer">
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={active ? 16 : 12}
                          fill={active ? '#f59e0b' : '#1e293b'}
                          stroke="#f8fafc"
                          strokeWidth="2"
                        />
                        <text x={pos.x} y={pos.y + 26} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="600">
                          {n.name.split(' ')[0]}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div className="flex items-center gap-4 text-[11px] text-slate-400 mt-2">
                  <span className="text-emerald-400">Green: Ally / Trade</span>
                  <span className="text-amber-300">Gold: Mentor</span>
                  <span className="text-red-400">Dashed Red: Rival</span>
                </div>
              </div>

              <div className="lg:col-span-5 p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-3">
                <div>
                  <div className="text-xs text-amber-300">{selectedNpc.role}</div>
                  <h3 className="text-base font-bold text-white">{selectedNpc.name}</h3>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Mood: {selectedNpc.mood} · Trust: {selectedNpc.relationshipScore} · Faction: {factions[selectedNpc.factionId].name}
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-white/10 pt-2">
                  <div className="text-xs font-semibold text-slate-300">Connections</div>
                  {selectedNpc.relationships.map((r) => {
                    const target = npcs.find((x) => x.id === r.targetId);
                    return (
                      <div key={r.targetId} className="flex justify-between text-xs">
                        <span className="text-slate-200">{target?.name}</span>
                        <span className={r.type === 'Rival' ? 'text-red-400' : 'text-emerald-400'}>
                          {r.type} ({r.strength > 0 ? `+${r.strength}` : r.strength})
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <button
                    type="button"
                    disabled={gold < 35}
                    onClick={() => onInfluenceNpc(selectedNpc.id)}
                    className="w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-semibold"
                  >
                    Grant Discrete Favor (35g) — Boost Trust & Regional Stability
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFastTravel(selectedNpc.x, selectedNpc.z + 3.5, selectedNpc.name);
                      onClose();
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white"
                  >
                    Travel to {selectedNpc.name}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
