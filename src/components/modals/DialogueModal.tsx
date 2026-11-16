import React, { useState } from 'react';
import { Mic, ShoppingBag, UserPlus, X } from 'lucide-react';
import { ITEMS } from '../../data/worldData';
import { FactionId, FactionState, NpcDialogueOption, NpcState, OutpostState, TimeOfDay } from '../../types/game';
import { getVendorPriceMultiplier } from './KingdomDashboardModal';

interface DialogueModalProps {
  npc: NpcState | null;
  timeOfDay: TimeOfDay;
  factions: Record<FactionId, FactionState>;
  outposts: OutpostState[];
  gold: number;
  activeCompanionId: string | null;
  onClose: () => void;
  onSelectOption: (npc: NpcState, opt: NpcDialogueOption) => string;
  onBuyItem: (npcId: string, itemId: string, price: number) => void;
  onOpenVoice: () => void;
}

export const DialogueModal: React.FC<DialogueModalProps> = ({
  npc,
  timeOfDay,
  factions,
  outposts,
  gold,
  activeCompanionId,
  onClose,
  onSelectOption,
  onBuyItem,
  onOpenVoice,
}) => {
  const [replyText, setReplyText] = useState<string>('');
  const [showShop, setShowShop] = useState(false);

  if (!npc) return null;

  const scheduleSlot = npc.schedules.find((s) => s.timeOfDay === timeOfDay) || npc.schedules[0];
  const faction = factions[npc.factionId];
  const priceMult = getVendorPriceMultiplier(faction.reputation);

  // Outposts rebuilt in this biome expand NPC merchant stock
  const localOutpost = outposts.find((o) => o.biomeId === npc.homeBiome && o.level > 0);
  const stockItems = [...npc.inventory];
  if (localOutpost) {
    localOutpost.unlockedStock.forEach((extraId) => {
      if (!stockItems.some((s) => s.id === extraId)) {
        stockItems.push({ id: extraId, qty: 2 });
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-label={`Conversation with ${npc.name}`}
    >
      <div className="w-full max-w-2xl rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <div className="text-xs text-amber-300">
              {npc.role} · {faction.name} · {scheduleSlot.activity} ({scheduleSlot.locationName})
            </div>
            <h2 className="font-display text-xl font-bold text-white mt-0.5">{npc.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVoice();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-amber-300"
            >
              <Mic className="w-3.5 h-3.5" />
              Speak Prompt
            </button>
            <button type="button" onClick={onClose} aria-label="End conversation" className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 rounded-lg bg-slate-900/90 border border-white/10 text-sm text-slate-100 leading-relaxed">
            “{replyText || npc.greeting}”
          </div>

          {!showShop ? (
            <div className="space-y-2">
              {npc.dialogueOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    if (opt.openShop) {
                      setShowShop(true);
                    }
                    const resp = onSelectOption(npc, opt);
                    setReplyText(resp);
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-sm text-slate-100 flex items-center justify-between gap-3 transition-colors"
                >
                  <span>{opt.label}</span>
                  {opt.recruitable && (
                    <span className="text-xs text-sky-300 flex items-center gap-1 whitespace-nowrap">
                      <UserPlus className="w-3.5 h-3.5" />
                      {activeCompanionId === npc.id ? 'Active Ally' : 'Recruit'}
                    </span>
                  )}
                  {opt.openShop && (
                    <span className="text-xs text-amber-300 flex items-center gap-1 whitespace-nowrap">
                      <ShoppingBag className="w-3.5 h-3.5" />
                      Trade
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">
                  Faction Price Modifier: <strong className="text-amber-300">{Math.round(priceMult * 100)}%</strong> · Gold:{' '}
                  <strong className="font-mono-tabular text-amber-300">{gold}g</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setShowShop(false)}
                  className="text-amber-300 hover:underline"
                >
                  Back to Dialogue
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto">
                {stockItems.map((entry) => {
                  const def = ITEMS[entry.id];
                  if (!def || entry.qty <= 0) return null;
                  const price = Math.max(5, Math.round(def.value * priceMult));
                  return (
                    <div key={entry.id} className="p-3 rounded-lg bg-slate-900 border border-white/10 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-white">
                          {def.name} <span className="text-slate-400">×{entry.qty}</span>
                        </div>
                        <div className="text-[11px] text-amber-300 font-mono-tabular">{price} Gold</div>
                      </div>
                      <button
                        type="button"
                        disabled={gold < price}
                        onClick={() => onBuyItem(npc.id, entry.id, price)}
                        className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-semibold"
                      >
                        Buy
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
