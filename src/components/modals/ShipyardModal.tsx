import React from 'react';
import { Anchor, Compass, Hammer, Shield, Ship, Wrench, X } from 'lucide-react';
import { SHIP_SPECS } from '../../entities/ships/ShipBuilder';
import { ShipHudState, ShipType } from '../../types/game';

interface ShipyardModalProps {
  open: boolean;
  gold: number;
  ownedShipType: ShipType;
  shipHud: ShipHudState | null;
  onClose: () => void;
  onRepairShip: () => void;
  onSummonShip: () => void;
  onCommissionShip: (type: ShipType, cost: number) => void;
}

const SHIP_ORDER: ShipType[] = ['sloop', 'brigantine', 'galleon'];

const SHIP_DESCRIPTIONS: Record<ShipType, string> = {
  sloop: 'Nimble coastal vessel built for narrow coves, fast tacking, and agile scouting.',
  brigantine: 'Twin-masted expedition warship balancing high open-ocean speed with twin cannon broadsides.',
  galleon: 'Heavy armored flagship commanding massive hull plating and devastating broadside salvos.',
};

export const ShipyardModal: React.FC<ShipyardModalProps> = ({
  open,
  gold,
  ownedShipType,
  shipHud,
  onClose,
  onRepairShip,
  onSummonShip,
  onCommissionShip,
}) => {
  if (!open) return null;

  const repairCost = 25;
  const needsRepair = shipHud ? shipHud.hull < shipHud.maxHull : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label="Aethelgard Drydock and Shipyard"
    >
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Anchor className="w-5 h-5 text-sky-300" />
            <div>
              <h2 className="font-display text-xl font-bold text-amber-300">Royal Drydock & Shipyard</h2>
              <p className="text-xs text-slate-400">
                Repair timber plating, summon your vessel to harbor, or commission larger warships · Treasury: {gold}g
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shipyard"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Active Vessel Quick Actions */}
          <div className="rounded-xl bg-slate-900/90 border border-white/10 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-sky-300" />
                <span className="font-semibold text-sm text-white">
                  Current Flagship: {SHIP_SPECS[ownedShipType].label}
                </span>
              </div>
              {shipHud ? (
                <div className="text-xs font-mono-tabular text-slate-300">
                  Hull Integrity: {shipHud.hull}/{shipHud.maxHull} · Wind: {shipHud.windKnots} kn ·{' '}
                  {shipHud.anchored ? 'Anchored' : 'Sails Ready'}
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  Vessel moored out at sea. Summon it directly to your nearest harbor berth.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSummonShip}
                className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Compass className="w-3.5 h-3.5" />
                Summon to Nearest Harbor
              </button>
              <button
                type="button"
                disabled={!needsRepair || gold < repairCost}
                onClick={onRepairShip}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 disabled:hover:bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Wrench className="w-3.5 h-3.5" />
                Repair Hull ({repairCost}g)
              </button>
            </div>
          </div>

          {/* Vessel Classes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SHIP_ORDER.map((type) => {
              const spec = SHIP_SPECS[type];
              const isOwned = ownedShipType === type;
              const canAfford = gold >= spec.cost;

              return (
                <div
                  key={type}
                  className={`rounded-xl p-4 border flex flex-col justify-between space-y-4 ${
                    isOwned
                      ? 'bg-sky-950/35 border-sky-400/50'
                      : 'bg-slate-900/75 border-white/10'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display font-bold text-sm text-amber-200">{spec.label}</h3>
                      {isOwned && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{SHIP_DESCRIPTIONS[type]}</p>

                    <div className="grid grid-cols-2 gap-1.5 pt-2 text-[11px] font-mono-tabular text-slate-300">
                      <div className="px-2 py-1 rounded bg-slate-950/60 flex items-center gap-1">
                        <Shield className="w-3 h-3 text-emerald-400" />
                        Hull {spec.maxHull}
                      </div>
                      <div className="px-2 py-1 rounded bg-slate-950/60">
                        Speed {Math.round(spec.maxSpeed)} kn
                      </div>
                      <div className="px-2 py-1 rounded bg-slate-950/60">
                        Salvo {spec.cannonDmg} dmg
                      </div>
                      <div className="px-2 py-1 rounded bg-slate-950/60">
                        Length {spec.length}m
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isOwned || !canAfford}
                    onClick={() => onCommissionShip(type, spec.cost)}
                    className={`w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      isOwned
                        ? 'bg-slate-800 text-slate-400 cursor-default'
                        : canAfford
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    {isOwned
                      ? 'Currently Active'
                      : spec.cost === 0
                        ? 'Refit Sloop (Free)'
                        : `Commission (${spec.cost}g)`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
