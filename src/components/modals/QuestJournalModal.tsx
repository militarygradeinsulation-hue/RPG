import React, { useEffect, useState } from 'react';
import { BookOpen, Compass, ExternalLink, Loader2, ScrollText, Search, X } from 'lucide-react';
import { JournalEntry, QuestChoice, QuestState, SeasonType, WeatherType } from '../../types/game';

interface QuestJournalModalProps {
  open: boolean;
  initialTab?: 'quests' | 'journal' | 'oracle';
  quests: QuestState[];
  journal: JournalEntry[];
  moralAlignment: number;
  sealsRestored: number;
  biomeName?: string;
  season?: SeasonType;
  weather?: WeatherType;
  onClose: () => void;
  onResolveChoice: (questId: string, choice: QuestChoice) => void;
}

interface SearchSource {
  title: string;
  uri: string;
}

const SketchIllustration: React.FC<{ type: JournalEntry['sketchType'] }> = ({ type }) => {
  return (
    <svg viewBox="0 0 180 120" className="w-full h-28 rounded-lg bg-[#161e2e] border border-amber-200/20 p-2" aria-hidden="true">
      {type === 'citadel' && (
        <g stroke="#fbbf24" strokeWidth="1.6" fill="none">
          <path d="M25 100 L155 100" />
          <rect x="45" y="55" width="90" height="45" />
          <rect x="70" y="30" width="40" height="70" />
          <polygon points="65,30 90,12 115,30" />
          <path d="M82 100 L82 78 A8 8 0 0 1 98 78 L98 100" />
        </g>
      )}
      {type === 'grove' && (
        <g stroke="#34d399" strokeWidth="1.6" fill="none">
          <path d="M20 100 Q90 85 160 100" />
          <path d="M60 95 L60 55 M40 60 Q60 22 80 60 Z" />
          <path d="M115 95 L115 48 M92 54 Q115 16 138 54 Z" />
        </g>
      )}
      {type === 'crag' && (
        <g stroke="#fb923c" strokeWidth="1.6" fill="none">
          <polygon points="20,102 65,35 105,102" />
          <polygon points="75,102 120,25 165,102" />
          <path d="M112 42 Q122 28 130 42" />
          <circle cx="120" cy="18" r="5" />
        </g>
      )}
      {type === 'spire' && (
        <g stroke="#38bdf8" strokeWidth="1.6" fill="none">
          <ellipse cx="90" cy="96" rx="60" ry="10" />
          <polygon points="90,14 106,88 74,88" />
          <circle cx="90" cy="30" r="14" strokeDasharray="3 3" />
        </g>
      )}
      {type === 'wraith' && (
        <g stroke="#c084fc" strokeWidth="1.6" fill="none">
          <path d="M65 98 Q90 25 115 98 Q102 88 90 98 Q78 88 65 98 Z" />
          <circle cx="90" cy="40" r="11" />
          <path d="M78 30 L70 16 M102 30 L110 16" />
        </g>
      )}
      {type === 'golem' && (
        <g stroke="#f97316" strokeWidth="1.6" fill="none">
          <rect x="64" y="34" width="52" height="44" rx="4" />
          <rect x="44" y="40" width="16" height="42" />
          <rect x="120" y="40" width="16" height="42" />
          <circle cx="90" cy="56" r="9" />
          <rect x="75" y="18" width="30" height="14" />
        </g>
      )}
      {type === 'stalker' && (
        <g stroke="#38bdf8" strokeWidth="1.6" fill="none">
          <polygon points="90,22 115,62 90,96 65,62" />
          <path d="M65 62 L35 44 L55 75 M115 62 L145 44 L125 75" />
        </g>
      )}
      {type === 'crown' && (
        <g stroke="#fde047" strokeWidth="1.6" fill="none">
          <circle cx="90" cy="60" r="34" />
          <polygon points="90,20 102,56 130,60 102,68 90,100 78,68 50,60 78,56" />
        </g>
      )}
    </svg>
  );
};

const ORACLE_PRESETS = [
  'How do real-world temperate rainforests recover after wildfire?',
  'Medieval stone citadel defenses and siege architecture',
  'Physics of volcanic lightning during ash eruptions',
  'Seasonal plant dormancy and frost tolerance in alpine flora',
];

export const QuestJournalModal: React.FC<QuestJournalModalProps> = ({
  open,
  initialTab = 'quests',
  quests,
  journal,
  moralAlignment,
  sealsRestored,
  biomeName = 'Suncrest Citadel',
  season = 'Spring',
  weather = 'Clear',
  onClose,
  onResolveChoice,
}) => {
  const [tab, setTab] = useState<'quests' | 'journal' | 'oracle'>(initialTab);
  const [oracleQuery, setOracleQuery] = useState('');
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleError, setOracleError] = useState('');
  const [oracleAnswer, setOracleAnswer] = useState('');
  const [oracleSources, setOracleSources] = useState<SearchSource[]>([]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  if (!open) return null;

  const moralLabel =
    moralAlignment >= 18 ? 'Light (Mercy & Restoration)' : moralAlignment <= -18 ? 'Shadow (Dominion & Ash)' : 'Balanced Warden';

  const runOracleSearch = async (queryText: string) => {
    if (!queryText.trim() || oracleLoading) return;
    setOracleLoading(true);
    setOracleError('');
    try {
      const res = await fetch('/api/search-lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText.trim(),
          biomeName,
          season,
          weather,
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        sources?: SearchSource[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Scholar Oracle request failed.');
      }
      setOracleAnswer(data.text || '');
      setOracleSources(data.sources || []);
    } catch (err) {
      setOracleError(err instanceof Error ? err.message : 'Unable to reach Scholar Oracle.');
    } finally {
      setOracleLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Prophecy Quests, Field Journal, and Scholar Oracle"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-display text-xl font-bold text-amber-300">Chronicle & Prophecy</h2>
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setTab('quests')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  tab === 'quests' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" />
                Prophecy & Quests
              </button>
              <button
                type="button"
                onClick={() => setTab('journal')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  tab === 'journal' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Field Sketches ({journal.filter((j) => j.discovered).length}/{journal.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('oracle')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  tab === 'oracle' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                Scholar Oracle
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close chronicle" className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'quests' && (
            <div className="space-y-6">
              {/* Grand Prophecy & Moral Alignment Bar */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-400/25">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                    <Compass className="w-4 h-4" />
                    Moral Alignment: {moralLabel}
                  </div>
                  <div className="font-mono-tabular text-xs text-slate-300">
                    Alignment {moralAlignment > 0 ? `+${moralAlignment}` : moralAlignment} · Seals Awakened {sealsRestored}/4
                  </div>
                </div>
                <div className="mt-3 h-2.5 rounded-full bg-slate-800 relative overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all"
                    style={{ width: `${((moralAlignment + 100) / 200) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                  <span>Shadow (-100)</span>
                  <span>Balanced (0)</span>
                  <span>Light (+100)</span>
                </div>
              </div>

              {/* Quest Cards */}
              <div className="space-y-4">
                {quests.map((q) => (
                  <div key={q.id} className="p-4 rounded-xl bg-slate-900/80 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs text-amber-300/90">
                          {q.isProphecyMain ? 'Main Prophecy' : 'Regional Quest'} · {q.biomeId} · {q.status}
                        </div>
                        <h3 className="text-base font-bold text-white mt-0.5">{q.title}</h3>
                      </div>
                      <span className="font-mono-tabular text-xs text-slate-300">
                        Step {q.step}/{q.maxSteps}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{q.description}</p>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {q.objectives.map((obj, i) => (
                        <li key={i} className={i < q.step ? 'line-through text-emerald-400' : ''}>
                          {i + 1}. {obj}
                        </li>
                      ))}
                    </ul>

                    {q.status !== 'completed' && q.choices && q.step >= 1 && (
                      <div className="pt-2 border-t border-white/10 space-y-2">
                        <div className="text-xs font-semibold text-amber-300">Moral Decision Available:</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {q.choices.map((ch) => (
                            <button
                              key={ch.id}
                              type="button"
                              onClick={() => onResolveChoice(q.id, ch)}
                              className="text-left p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs space-y-1"
                            >
                              <div className="font-semibold text-white">{ch.label}</div>
                              <div className="text-slate-400">{ch.consequenceText}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {q.chosenPath && (
                      <div className="text-xs text-emerald-300 pt-1">Consequence enacted: {q.chosenPath}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'journal' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {journal.map((entry) => (
                <div
                  key={entry.id}
                  className={`p-4 rounded-xl border ${
                    entry.discovered ? 'bg-slate-900/90 border-white/15' : 'bg-slate-950/60 border-white/5 opacity-60'
                  }`}
                >
                  {entry.discovered ? (
                    <>
                      <SketchIllustration type={entry.sketchType} />
                      <div className="mt-3 flex items-center justify-between">
                        <h3 className="font-display text-sm font-bold text-amber-300">{entry.title}</h3>
                        <span className="text-xs text-slate-400">{entry.category} · {entry.biomeId}</span>
                      </div>
                      <p className="text-xs text-slate-200 mt-1.5 leading-relaxed">{entry.summary}</p>
                      <p className="text-[11px] text-emerald-300/90 mt-2">{entry.ecologicalNote}</p>
                    </>
                  ) : (
                    <div className="h-44 flex flex-col items-center justify-center text-center p-4">
                      <span className="text-xs font-semibold text-slate-400">Uncharted Entry ({entry.category})</span>
                      <span className="text-[11px] text-slate-500 mt-1">Explore {entry.biomeId} or confront local creatures to sketch this entry.</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'oracle' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-400/20 space-y-3">
                <div className="text-xs text-slate-300">
                  Query real-world ecology, medieval craftsmanship, meteorology, and mythology grounded with live web sources for{' '}
                  <strong className="text-amber-300">{biomeName}</strong>.
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runOracleSearch(oracleQuery);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={oracleQuery}
                    onChange={(e) => setOracleQuery(e.target.value)}
                    placeholder="Ask about real-world forest restoration, volcanic storms, stone masonry..."
                    aria-label="Scholar Oracle research query"
                    className="flex-1 rounded-lg bg-slate-950 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={oracleLoading || !oracleQuery.trim()}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                  >
                    {oracleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Research
                  </button>
                </form>

                <div className="flex flex-wrap gap-2">
                  {ORACLE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setOracleQuery(preset);
                        void runOracleSearch(preset);
                      }}
                      className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-white/10 text-[11px] text-slate-200"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {oracleError && (
                <div className="p-3 rounded-lg bg-red-950/70 border border-red-400/30 text-xs text-red-200">{oracleError}</div>
              )}

              {oracleAnswer && (
                <div className="p-4 rounded-xl bg-slate-900/95 border border-white/15 space-y-3">
                  <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{oracleAnswer}</div>
                  {oracleSources.length > 0 && (
                    <div className="pt-3 border-t border-white/10 space-y-1.5">
                      <div className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">Grounded Sources</div>
                      <div className="flex flex-wrap gap-2">
                        {oracleSources.map((src, i) => (
                          <a
                            key={`${src.uri}_${i}`}
                            href={src.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-sky-300"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span className="truncate max-w-[220px]">{src.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
