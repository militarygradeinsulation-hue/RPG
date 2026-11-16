import React from 'react';
import { Flame, Shield, Snowflake, Wind, Zap, X, Check } from 'lucide-react';
import { INITIAL_SKILLS } from '../../data/worldData';
import { PlayerState } from '../../types/game';

interface SkillTreeModalProps {
  open: boolean;
  player: PlayerState;
  unlockedSkills: string[];
  onClose: () => void;
  onUnlockSkill: (skillId: string) => void;
}

export const SkillTreeModal: React.FC<SkillTreeModalProps> = ({
  open,
  player,
  unlockedSkills,
  onClose,
  onUnlockSkill,
}) => {
  if (!open) return null;

  const branches: {
    id: 'warden' | 'fire' | 'lightning' | 'frost' | 'gale';
    label: string;
    uses: number;
    icon: React.ReactNode;
    accent: string;
  }[] = [
    { id: 'warden', label: 'Warden Core', uses: player.level, icon: <Shield className="w-4 h-4" />, accent: '#fbbf24' },
    { id: 'fire', label: 'Pyromancer', uses: player.elementalUses.fire, icon: <Flame className="w-4 h-4" />, accent: '#f97316' },
    { id: 'lightning', label: 'Tempest Weaver', uses: player.elementalUses.lightning, icon: <Zap className="w-4 h-4" />, accent: '#38bdf8' },
    { id: 'frost', label: 'Cryo-Warden', uses: player.elementalUses.frost, icon: <Snowflake className="w-4 h-4" />, accent: '#67e8f9' },
    { id: 'gale', label: 'Gale Strider', uses: player.elementalUses.gale, icon: <Wind className="w-4 h-4" />, accent: '#4ade80' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Dynamic Elemental Affinity Skill Tree"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-xl font-bold text-amber-300">Elemental Affinity Tree</h2>
            <p className="text-xs text-slate-400">
              Branches expand dynamically as you cast Fire, Lightning, Frost, and Gale spells in battle
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close skill tree" className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {branches.map((br) => {
            const nodes = INITIAL_SKILLS.filter((s) => s.branch === br.id);
            return (
              <div key={br.id} className="p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-sm" style={{ color: br.accent }}>
                    {br.icon}
                    <span>{br.label}</span>
                  </div>
                  <span className="font-mono-tabular text-xs text-slate-300">
                    {br.id === 'warden' ? `Warden Level ${br.uses}` : `${br.uses} Casts Recorded`}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {nodes.map((node) => {
                    const isUnlocked = unlockedSkills.includes(node.id);
                    const meetsReq = br.uses >= node.affinityReq;
                    return (
                      <div
                        key={node.id}
                        className={`p-3 rounded-lg border flex flex-col justify-between gap-3 ${
                          isUnlocked
                            ? 'bg-slate-800/90 border-amber-400/50'
                            : meetsReq
                              ? 'bg-slate-950 border-white/20'
                              : 'bg-slate-950/60 border-white/5 opacity-60'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">{node.name}</span>
                            <span className="font-mono-tabular text-[11px] text-slate-400">Tier {node.tier}</span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1">{node.description}</p>
                          <div className="text-[11px] text-emerald-300 mt-1.5">{node.effect}</div>
                        </div>

                        {isUnlocked ? (
                          <div className="flex items-center gap-1 text-xs font-semibold text-amber-300">
                            <Check className="w-3.5 h-3.5" />
                            Active Mastery
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={!meetsReq}
                            onClick={() => onUnlockSkill(node.id)}
                            className="w-full py-1.5 px-3 rounded-md bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-semibold"
                          >
                            {meetsReq ? 'Unlock Skill' : `Requires ${node.affinityReq} ${br.id === 'warden' ? 'Level' : 'Casts'}`}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
