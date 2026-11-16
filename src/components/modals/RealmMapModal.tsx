import React, { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Anchor, Compass, Globe, Loader2, Map as MapIcon, MapPin, Navigation, Search, X } from 'lucide-react';
import { getBiomeAt, groundHeightAt, WATER_LEVEL } from '../../engine/terrain';
import { WORLD_POIS } from '../../world/ocean/ArchipelagoGen';
import { BiomeId, BiomeState } from '../../types/game';

interface BiomePortalQuery {
  biomeId: BiomeId;
  title: string;
  searchQuery: string;
  coords3d: { x: number; z: number };
  pinColor: string;
  borderColor: string;
  loreNote: string;
}

const BIOME_PORTAL_QUERIES: BiomePortalQuery[] = [
  {
    biomeId: 'suncrest',
    title: 'Suncrest Citadel',
    searchQuery: 'tidal island abbey fortress Normandy',
    coords3d: { x: 0, z: 6 },
    pinColor: '#f59e0b',
    borderColor: '#92400e',
    loreNote: 'Tidal stone ramparts and solar keep inspiration for Aethelgard’s central bastion.',
  },
  {
    biomeId: 'verdant',
    title: 'Verdant Vale',
    searchQuery: 'temperate rainforest moss canopy Olympic Peninsula',
    coords3d: { x: -50, z: 32 },
    pinColor: '#10b981',
    borderColor: '#065f46',
    loreNote: 'Moss-draped ancient canopies echoing the Druidic Seal’s living ecosystem.',
  },
  {
    biomeId: 'ember',
    title: 'Ember Crag',
    searchQuery: 'active stratovolcano crater Sicily',
    coords3d: { x: 56, z: 38 },
    pinColor: '#f97316',
    borderColor: '#9a3412',
    loreNote: 'Basalt ridges and active volcanic fumaroles mirrored by the Forge’s magma vents.',
  },
  {
    biomeId: 'aether',
    title: 'Aether Spire',
    searchQuery: 'glacier ice cap lagoon Iceland',
    coords3d: { x: 0, z: -74 },
    pinColor: '#38bdf8',
    borderColor: '#075985',
    loreNote: 'Glacial ridges and high-latitude auroras guiding the Frost-Lightning convergence.',
  },
];

interface ResolvedPlaceResult {
  id: string;
  name: string;
  address: string;
  position: { lat: number; lng: number };
  biomePortal?: BiomePortalQuery;
}

interface PlaceMarkerItemProps {
  place: ResolvedPlaceResult;
  biomeHealth?: number;
  selected: boolean;
  onSelect: () => void;
  onCloseInfo: () => void;
  onFastTravel?: (x: number, z: number, label: string) => void;
}

const PlaceMarkerItem: React.FC<PlaceMarkerItemProps> = ({
  place,
  biomeHealth,
  selected,
  onSelect,
  onCloseInfo,
  onFastTravel,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const pinColor = place.biomePortal?.pinColor || '#c084fc';
  const borderColor = place.biomePortal?.borderColor || '#581c87';

  return (
    <>
      <AdvancedMarker ref={markerRef} position={place.position} title={place.name} onClick={onSelect}>
        <Pin background={pinColor} borderColor={borderColor} glyphColor="#090d16" scale={1.15} />
      </AdvancedMarker>

      {selected && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={onCloseInfo}>
          <div className="p-1 text-slate-900 space-y-1.5">
            <div className="font-bold text-sm">
              {place.biomePortal ? `${place.biomePortal.title} Analog` : place.name}
            </div>
            <div className="text-[11px] font-semibold text-slate-700">{place.name}</div>
            {place.address && <div className="text-[11px] text-slate-500">{place.address}</div>}
            {place.biomePortal && (
              <>
                <p className="text-xs text-slate-700 leading-snug">{place.biomePortal.loreNote}</p>
                {biomeHealth !== undefined && (
                  <div className="text-[11px] font-semibold text-emerald-700">
                    In-Game Biome Health: {Math.round(biomeHealth)}%
                  </div>
                )}
                {onFastTravel && (
                  <button
                    type="button"
                    onClick={() =>
                      onFastTravel(
                        place.biomePortal!.coords3d.x,
                        place.biomePortal!.coords3d.z,
                        place.biomePortal!.title
                      )
                    }
                    className="w-full mt-1 px-2.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-1"
                  >
                    <Navigation className="w-3 h-3" />
                    Travel to {place.biomePortal.title} in 3D
                  </button>
                )}
              </>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface AtlasMapContentProps {
  biomes: Record<BiomeId, BiomeState>;
  activePortalQuery: BiomePortalQuery | null;
  customSearchTrigger: { query: string; nonce: number } | null;
  onSearchStateChange: (busy: boolean, err: string) => void;
  onFastTravel: (x: number, z: number, label: string) => void;
}

const AtlasMapContent: React.FC<AtlasMapContentProps> = ({
  biomes,
  activePortalQuery,
  customSearchTrigger,
  onSearchStateChange,
  onFastTravel,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const [markers, setMarkers] = useState<ResolvedPlaceResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const runPlacesTextSearch = async (textQuery: string, biomePortal?: BiomePortalQuery) => {
    if (!placesLib) return;
    const PlaceCtor = (placesLib as unknown as {
      Place?: {
        searchByText: (req: {
          textQuery: string;
          fields: string[];
          maxResultCount?: number;
        }) => Promise<{
          places: Array<{
            id?: string;
            displayName?: string;
            formattedAddress?: string;
            location?: { lat: () => number; lng: () => number };
          }>;
        }>;
      };
    }).Place;

    if (!PlaceCtor?.searchByText) {
      onSearchStateChange(false, 'Places library is still initializing.');
      return;
    }

    onSearchStateChange(true, '');
    try {
      const { places } = await PlaceCtor.searchByText({
        textQuery,
        fields: ['id', 'displayName', 'formattedAddress', 'location'],
        maxResultCount: biomePortal ? 1 : 5,
      });

      const resolved: ResolvedPlaceResult[] = places
        .filter((p) => p.location)
        .map((p, idx) => ({
          id: p.id || `place_${Date.now()}_${idx}`,
          name: p.displayName || 'Real-World Landmark',
          address: p.formattedAddress || '',
          position: { lat: p.location!.lat(), lng: p.location!.lng() },
          biomePortal,
        }));

      setMarkers(resolved);
      if (resolved[0] && map) {
        map.panTo(resolved[0].position);
        map.setZoom(biomePortal ? 9 : 6);
        setSelectedId(resolved[0].id);
      }
      onSearchStateChange(false, resolved.length === 0 ? 'No matching places found.' : '');
    } catch (err) {
      onSearchStateChange(false, err instanceof Error ? err.message : 'Places search failed.');
    }
  };

  useEffect(() => {
    if (!placesLib || !activePortalQuery) return;
    void runPlacesTextSearch(activePortalQuery.searchQuery, activePortalQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLib, activePortalQuery]);

  useEffect(() => {
    if (!placesLib || !customSearchTrigger?.query.trim()) return;
    void runPlacesTextSearch(customSearchTrigger.query.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLib, customSearchTrigger]);

  return (
    <>
      {markers.map((place) => (
        <PlaceMarkerItem
          key={place.id}
          place={place}
          biomeHealth={place.biomePortal ? biomes[place.biomePortal.biomeId]?.health : undefined}
          selected={selectedId === place.id}
          onSelect={() => {
            setSelectedId(place.id);
            map?.panTo(place.position);
          }}
          onCloseInfo={() => setSelectedId(null)}
          onFastTravel={onFastTravel}
        />
      ))}
    </>
  );
};

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
  const [tab, setTab] = useState<'nautical' | 'google'>('nautical');
  const [apiKey, setApiKey] = useState<string>(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '');
  const [loadingKey, setLoadingKey] = useState(false);
  const [activePortal, setActivePortal] = useState<BiomePortalQuery | null>(BIOME_PORTAL_QUERIES[0]);
  const [searchInput, setSearchInput] = useState('');
  const [searchTrigger, setSearchTrigger] = useState<{ query: string; nonce: number } | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [searchError, setSearchError] = useState('');
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open || apiKey) return;
    setLoadingKey(true);
    fetch('/api/maps-config')
      .then((r) => r.json())
      .then((d: { apiKey?: string }) => {
        if (d.apiKey) setApiKey(d.apiKey);
      })
      .catch(() => {
        // Fallback already checked
      })
      .finally(() => setLoadingKey(false));
  }, [open, apiKey]);

  // Render interactive Aethelgard & Archipelago Sea Chart
  useEffect(() => {
    if (!open || tab !== 'nautical') return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const minX = -240;
    const maxX = 240;
    const minZ = -140;
    const maxZ = 280;

    const img = ctx.createImageData(W, H);
    const data = img.data;

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
          r = Math.round(28 - depth * 16);
          g = Math.round(74 - depth * 36);
          bl = Math.round(118 - depth * 42);
        } else {
          const pal = BIOME_PALETTE[b];
          const elev = Math.min(1, h / 22);
          r = Math.min(255, Math.round(pal[0] + elev * 68));
          g = Math.min(255, Math.round(pal[1] + elev * 64));
          bl = Math.min(255, Math.round(pal[2] + elev * 68));
          if (Math.abs((h * 1.2) % 3) < 0.25) {
            r = Math.max(0, r - 18);
            g = Math.max(0, g - 18);
            bl = Math.max(0, bl - 16);
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

    // Subtle nautical grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
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
    ctx.font = '11px Inter, sans-serif';
    WORLD_POIS.forEach((poi) => {
      const { sx, sy } = toScreen(poi.x, poi.z);
      ctx.fillStyle = poi.kind === 'harbor' ? '#38bdf8' : poi.kind === 'capital' ? '#fbbf24' : '#cbd5e1';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, poi.kind === 'capital' ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
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
    ctx.fillStyle = '#6ee7b7';
    ctx.fillText('You', ps.sx + 8, ps.sy + 4);
  }, [open, tab, playerX, playerZ]);

  if (!open) return null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    setActivePortal(null);
    setSearchTrigger({ query: searchInput.trim(), nonce: Date.now() });
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
                Chart Aethelgard’s regions, harbors & offshore islands or inspect real-world Google Maps biome analogs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('nautical')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'nautical' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Kingdom & Sea Chart
            </button>
            <button
              type="button"
              onClick={() => setTab('google')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'google' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Google Maps Analogs
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

        {tab === 'nautical' ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-xl overflow-hidden border border-white/15 bg-slate-950">
                <canvas ref={chartCanvasRef} width={640} height={420} className="w-full h-auto block" />
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
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
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {BIOME_PORTAL_QUERIES.map((portal) => (
                  <button
                    key={portal.biomeId}
                    type="button"
                    onClick={() => setActivePortal(portal)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
                      activePortal?.biomeId === portal.biomeId
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 text-slate-200 border-white/10 hover:bg-slate-800'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    {portal.title}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search real-world landmarks..."
                  aria-label="Search real-world landmarks"
                  className="w-56 rounded-lg bg-slate-900 border border-white/15 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={searchingPlaces || !apiKey}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5"
                >
                  {searchingPlaces ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  Find
                </button>
              </form>
            </div>

            {searchError && (
              <div className="p-2.5 rounded-lg bg-slate-900 border border-amber-400/30 text-xs text-amber-200">
                {searchError}
              </div>
            )}

            <div className="w-full h-[430px] rounded-xl overflow-hidden border border-white/15 bg-slate-950 relative">
              {loadingKey ? (
                <div className="w-full h-full flex items-center justify-center text-sm text-slate-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading World Atlas configuration...
                </div>
              ) : !apiKey ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                  <Compass className="w-8 h-8 text-amber-300" />
                  <div className="text-sm font-semibold text-white">Maps API Key Unavailable</div>
                  <p className="text-xs text-slate-400 max-w-md">
                    Google Maps key is not present in the runtime environment. Verify the GOOGLE_MAPS_API_KEY configuration to display the interactive atlas.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {BIOME_PORTAL_QUERIES.map((l) => (
                      <button
                        key={l.biomeId}
                        type="button"
                        onClick={() => {
                          onFastTravel(l.coords3d.x, l.coords3d.z, l.title);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold"
                      >
                        Fast Travel: {l.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <APIProvider apiKey={apiKey} libraries={['marker', 'places']} language="en" region="US">
                  <GoogleMap
                    mapId="DEMO_MAP_ID"
                    defaultCenter={{ lat: 20, lng: 0 }}
                    defaultZoom={2}
                    gestureHandling="greedy"
                    internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <AtlasMapContent
                      biomes={biomes}
                      activePortalQuery={activePortal}
                      customSearchTrigger={searchTrigger}
                      onSearchStateChange={(busy, err) => {
                        setSearchingPlaces(busy);
                        setSearchError(err);
                      }}
                      onFastTravel={(x, z, label) => {
                        onFastTravel(x, z, label);
                        onClose();
                      }}
                    />
                  </GoogleMap>
                </APIProvider>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
