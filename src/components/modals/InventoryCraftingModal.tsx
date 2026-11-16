import React, { useState } from 'react';
import { Backpack, FlaskConical, Sparkles, X, ArrowRight } from 'lucide-react';
import { INITIAL_RECIPES, ITEMS } from '../../data/worldData';
import { InventoryItem } from '../../types/game';

interface InventoryCraftingModalProps {
  open: boolean;
  initialTab?: 'inventory' | 'craft';
  inventory: InventoryItem[];
  discoveredRecipes: string[];
  equippedWeapon: string;
  equippedRelic: string | null;
  gold: number;
  onClose: () => void;
  onUseOrEquip: (itemId: string) => void;
  onCraftResult: (consumed: [string, string, string], resultId: string, resultQty: number, recipeId: string) => void;
}

export const InventoryCraftingModal: React.FC<InventoryCraftingModalProps> = ({
  open,
  initialTab = 'inventory',
  inventory,
  discoveredRecipes,
  equippedWeapon,
  equippedRelic,
  gold,
  onClose,
  onUseOrEquip,
  onCraftResult,
}) => {
  const [tab, setTab] = useState<'inventory' | 'craft'>(initialTab);
  const [filter, setFilter] = useState<'all' | 'resource' | 'catalyst' | 'consumable' | 'relic'>('all');
  const [crucible, setCrucible] = useState<[string | null, string | null, string | null]>([null, null, null]);
  const [craftMessage, setCraftMessage] = useState<string>('Drag materials or click items to experiment with catalysts in the 3-slot Crucible.');

  if (!open) return null;

  const filteredItems = inventory.filter((entry) => {
    const def = ITEMS[entry.id];
    if (!def || entry.qty <= 0) return false;
    if (filter === 'all') return true;
    if (filter === 'resource') return def.category === 'resource' || def.category === 'material';
    return def.category === filter;
  });

  const countInCrucible = (itemId: string) => crucible.filter((c) => c === itemId).length;
  const availableQty = (itemId: string) => {
    const inv = inventory.find((i) => i.id === itemId)?.qty || 0;
    return inv - countInCrucible(itemId);
  };

  const assignToSlot = (slotIdx: number, itemId: string) => {
    if (availableQty(itemId) <= 0) return;
    const next: [string | null, string | null, string | null] = [...crucible] as [string | null, string | null, string | null];
    next[slotIdx] = itemId;
    setCrucible(next);
  };

  const quickAssign = (itemId: string) => {
    const emptyIdx = crucible.findIndex((s) => s === null);
    if (emptyIdx === -1) {
      setCraftMessage('Crucible slots are full. Clear a slot to swap catalysts.');
      return;
    }
    assignToSlot(emptyIdx, itemId);
  };

  const handleSynthesize = () => {
    if (!crucible[0] || !crucible[1] || !crucible[2]) {
      setCraftMessage('Place 3 catalysts or materials in the Crucible first.');
      return;
    }
    const chosen = [crucible[0], crucible[1], crucible[2]].sort().join('|');
    const match = INITIAL_RECIPES.find((r) => [...r.ingredients].sort().join('|') === chosen);

    if (match) {
      onCraftResult(
        [crucible[0], crucible[1], crucible[2]],
        match.resultId,
        match.resultQty,
        match.id
      );
      const isNew = !discoveredRecipes.includes(match.id);
      setCraftMessage(
        isNew
          ? `New Formula Discovered! Crafted ${match.resultQty}x ${ITEMS[match.resultId].name}.`
          : `Crafted ${match.resultQty}x ${ITEMS[match.resultId].name}.`
      );
      setCrucible([null, null, null]);
    } else {
      // Experimentation yields 1x Vitality Elixir or harmless fizzle without losing rare gear
      setCraftMessage('Volatile reaction! Try balancing Fire + Frost, or Storm + Gale + Frost catalysts.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Inventory and Catalyst Crucible"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-6">
            <h2 className="font-display text-xl font-bold text-amber-300">Satchel & Crucible</h2>
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setTab('inventory')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  tab === 'inventory' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Backpack className="w-3.5 h-3.5" />
                Inventory
              </button>
              <button
                type="button"
                onClick={() => setTab('craft')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  tab === 'craft' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5" />
                Catalyst Crafting
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono-tabular text-sm text-amber-300 font-semibold">{gold} Gold</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inventory"
              className="p-2 rounded-lg hover:bg-white/10 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'inventory' ? (
            <div className="space-y-5">
              {/* Equipment & Filter */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div className="text-sm text-slate-300 flex items-center gap-3">
                  <span>Weapon: <strong className="text-white">{ITEMS[equippedWeapon]?.name || 'Suncrest Blade'}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Relic: <strong className="text-amber-300">{equippedRelic ? ITEMS[equippedRelic]?.name : 'None'}</strong></span>
                </div>
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-white/10">
                  {(['all', 'resource', 'catalyst', 'consumable', 'relic'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 rounded text-xs font-medium capitalize ${
                        filter === f ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  No items in this category yet. Harvest resource nodes or defeat enemies across the realm.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredItems.map((entry) => {
                    const def = ITEMS[entry.id];
                    const isEquipped = equippedWeapon === entry.id || equippedRelic === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-4 p-4 rounded-lg bg-slate-900/90 border border-white/10"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white truncate">{def.name}</span>
                            <span className="font-mono-tabular text-xs text-amber-300">×{entry.qty}</span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {def.rarity} · {def.category} · {def.value}g
                          </div>
                          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">{def.description}</p>
                        </div>
                        {(def.category === 'consumable' || def.category === 'relic') && (
                          <button
                            type="button"
                            onClick={() => onUseOrEquip(entry.id)}
                            disabled={isEquipped}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                              isEquipped
                                ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                            }`}
                          >
                            {isEquipped ? 'Equipped' : def.category === 'consumable' ? 'Use Item' : 'Equip'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Draggable Materials */}
              <div className="lg:col-span-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">Available Reagents (Drag or Click to Slot)</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {inventory
                    .filter((i) => {
                      const d = ITEMS[i.id];
                      return d && (d.category === 'resource' || d.category === 'catalyst' || d.category === 'material') && availableQty(i.id) > 0;
                    })
                    .map((entry) => {
                      const def = ITEMS[entry.id];
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', entry.id)}
                          onClick={() => quickAssign(entry.id)}
                          className="text-left p-3 rounded-lg bg-slate-900 border border-white/10 hover:border-amber-400/60 transition-colors cursor-grab active:cursor-grabbing"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-white truncate">{def.name}</span>
                            <span className="font-mono-tabular text-xs text-amber-300">×{availableQty(entry.id)}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">{def.rarity} {def.element ? `· ${def.element}` : ''}</div>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Right: 3-Slot Drag-and-Drop Crucible & Discovered Formulas */}
              <div className="lg:col-span-6 space-y-5">
                <div className="p-4 rounded-xl bg-slate-900/95 border border-white/15">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      Alchemical Crucible
                    </h3>
                    <button
                      type="button"
                      onClick={() => setCrucible([null, null, null])}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Clear Slots
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {crucible.map((slotItem, idx) => (
                      <div
                        key={idx}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData('text/plain');
                          if (id) assignToSlot(idx, id);
                        }}
                        onClick={() => {
                          if (slotItem) {
                            const next = [...crucible] as [string | null, string | null, string | null];
                            next[idx] = null;
                            setCrucible(next);
                          }
                        }}
                        className="h-20 rounded-lg border border-dashed border-amber-400/40 bg-slate-950/80 flex flex-col items-center justify-center p-2 text-center cursor-pointer hover:border-amber-400"
                      >
                        {slotItem ? (
                          <>
                            <span className="text-xs font-semibold text-white">{ITEMS[slotItem]?.name}</span>
                            <span className="text-[10px] text-slate-400 mt-1">Click to remove</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">Drop Slot {idx + 1}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-slate-300 mt-3">{craftMessage}</p>

                  <button
                    type="button"
                    onClick={handleSynthesize}
                    className="mt-4 w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    Craft Item
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Recipe Tome */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-300">Discovered & Rumored Formulas</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {INITIAL_RECIPES.map((rec) => {
                      const known = discoveredRecipes.includes(rec.id);
                      const resultDef = ITEMS[rec.resultId];
                      return (
                        <div
                          key={rec.id}
                          className="p-2.5 rounded-lg bg-slate-900/70 border border-white/10 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="text-xs font-semibold text-white">
                              {known ? `${rec.resultQty}x ${resultDef.name}` : 'Undiscovered Catalyst Formula'}
                            </div>
                            <div className="text-[11px] text-slate-400">{rec.hint}</div>
                          </div>
                          {known && (
                            <button
                              type="button"
                              onClick={() => {
                                const counts: Record<string, number> = {};
                                rec.ingredients.forEach((ing) => (counts[ing] = (counts[ing] || 0) + 1));
                                const hasAll = Object.entries(counts).every(
                                  ([id, req]) => (inventory.find((i) => i.id === id)?.qty || 0) >= req
                                );
                                if (hasAll) {
                                  setCrucible([rec.ingredients[0], rec.ingredients[1], rec.ingredients[2]]);
                                } else {
                                  setCraftMessage('Missing ingredients for quick-fill.');
                                }
                              }}
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-300 whitespace-nowrap"
                            >
                              Load
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
