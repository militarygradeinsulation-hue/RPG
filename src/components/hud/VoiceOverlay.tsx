import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio, Send, Sparkles, VolumeX, X } from 'lucide-react';

interface VoiceOverlayProps {
  open: boolean;
  worldContext?: string;
  onClose: () => void;
  onExecuteVoiceCommand: (transcript: string) => string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface LiveTranscriptLine {
  id: string;
  speaker: 'You' | 'NPC' | 'System';
  text: string;
}

const PERSONAS = [
  { id: 'rowan', label: 'Elder Rowan (Sage)', persona: 'Elder Rowan, Keeper of the Suncrest Prophecy', voice: 'Charon' },
  { id: 'lyra', label: 'Lyra (Ranger)', persona: 'Lyra, Verdant Circle Ranger & Companion', voice: 'Kore' },
  { id: 'thorin', label: 'Thorin (Forge)', persona: 'Thorin, Ironbound Forge-Smith', voice: 'Fenrir' },
  { id: 'vespera', label: 'Vespera (Seer)', persona: 'Vespera, Aether Spire Mystic', voice: 'Zephyr' },
] as const;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export const VoiceOverlay: React.FC<VoiceOverlayProps> = ({
  open,
  worldContext = 'Suncrest Citadel, Kingdom of Aethelgard',
  onClose,
  onExecuteVoiceCommand,
}) => {
  const [tab, setTab] = useState<'live' | 'tactical'>('live');

  // Tactical SpeechRecognition state
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState(
    'Speak or type a command such as "Flank", "Heal", "Cast Fire", "Negotiate Peace", or "Demand Discount".'
  );
  const [speechSupported, setSpeechSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  // Bidirectional Gemini Live API state
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('rowan');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [liveError, setLiveError] = useState('');
  const [liveLog, setLiveLog] = useState<LiveTranscriptLine[]>([]);
  const [liveTextInput, setLiveTextInput] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const liveConnectedRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const stopLiveSession = () => {
    liveConnectedRef.current = false;
    try {
      processorRef.current?.disconnect();
    } catch {
      // Ignore
    }
    processorRef.current = null;
    try {
      inputCtxRef.current?.close();
    } catch {
      // Ignore
    }
    inputCtxRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Ignore
      }
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    try {
      outputCtxRef.current?.close();
    } catch {
      // Ignore
    }
    outputCtxRef.current = null;
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
    setLiveStatus('idle');
  };

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    setSpeechSupported(!!SR);
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        // Ignore
      }
      stopLiveSession();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      stopLiveSession();
    }
  }, [open]);

  if (!open) return null;

  const schedulePcmPlayback = (base64: string) => {
    if (!outputCtxRef.current) {
      outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = outputCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const int16 = base64ToInt16Array(base64);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  };

  const interruptPlayback = () => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Ignore
      }
    });
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
  };

  const startLiveSession = async () => {
    stopLiveSession();
    setLiveStatus('connecting');
    setLiveError('');

    const personaCfg = PERSONAS.find((p) => p.id === selectedPersonaId) || PERSONAS[0];
    setLiveLog([
      {
        id: `sys_${Date.now()}`,
        speaker: 'System',
        text: `Opening live voice channel with ${personaCfg.label}...`,
      },
    ]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const outputCtx = new AudioContext({ sampleRate: 24000 });
      outputCtxRef.current = outputCtx;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = new URLSearchParams({
        persona: personaCfg.persona,
        voice: personaCfg.voice,
        context: worldContext,
      });
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live-ws?${qs.toString()}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            ready?: boolean;
            audio?: string;
            inputTranscript?: string;
            outputTranscript?: string;
            interrupted?: boolean;
            error?: string;
            closed?: boolean;
          };
          if (msg.ready) {
            liveConnectedRef.current = true;
            setLiveStatus('connected');
            setLiveLog((prev) => [
              ...prev,
              { id: `sys_ready_${Date.now()}`, speaker: 'System', text: 'Voice link active. Speak naturally!' },
            ]);
          }
          if (msg.audio) {
            schedulePcmPlayback(msg.audio);
          }
          if (msg.interrupted) {
            interruptPlayback();
          }
          if (msg.inputTranscript) {
            setLiveLog((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.speaker === 'You') {
                return [...prev.slice(0, -1), { ...last, text: last.text + msg.inputTranscript }];
              }
              return [...prev, { id: `u_${Date.now()}`, speaker: 'You', text: msg.inputTranscript! }];
            });
          }
          if (msg.outputTranscript) {
            setLiveLog((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.speaker === 'NPC') {
                return [...prev.slice(0, -1), { ...last, text: last.text + msg.outputTranscript }];
              }
              return [...prev, { id: `n_${Date.now()}`, speaker: 'NPC', text: msg.outputTranscript! }];
            });
          }
          if (msg.error) {
            setLiveError(msg.error);
            setLiveStatus('error');
          }
          if (msg.closed) {
            stopLiveSession();
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        setLiveError('Live WebSocket connection error.');
        setLiveStatus('error');
      };

      ws.onclose = () => {
        liveConnectedRef.current = false;
      };

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!liveConnectedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(JSON.stringify({ audio: arrayBufferToBase64(int16.buffer) }));
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Microphone access or Live connection failed.');
      setLiveStatus('error');
    }
  };

  const sendLiveTextPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveTextInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const text = liveTextInput.trim();
    wsRef.current.send(JSON.stringify({ text }));
    setLiveLog((prev) => [...prev, { id: `u_${Date.now()}`, speaker: 'You', text }]);
    setLiveTextInput('');
  };

  const startListening = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) {
      setFeedback('Browser speech recognition is unavailable here; type your command below.');
      return;
    }
    try {
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = (ev) => {
        const spoken = ev.results[0]?.[0]?.transcript || '';
        setTranscript(spoken);
        const reply = onExecuteVoiceCommand(spoken);
        setFeedback(reply);
      };
      rec.onerror = () => {
        setListening(false);
        setFeedback('Could not capture voice audio. You can also type your prompt below.');
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
      setFeedback('Listening for voice command...');
    } catch {
      setListening(false);
    }
  };

  const stopListening = () => {
    try {
      recRef.current?.stop();
    } catch {
      // Ignore
    }
    setListening(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transcript.trim()) return;
    const reply = onExecuteVoiceCommand(transcript.trim());
    setFeedback(reply);
  };

  const quickPrompts = ['Companion Flank', 'Companion Heal', 'Cast Fire', 'Negotiate Peace', 'Demand Discount'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Voice Command and Live Dialogue Overlay"
    >
      <div className="w-full max-w-2xl rounded-xl hud-modal p-6 shadow-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h2 className="font-display text-lg font-bold text-amber-300">Voice & Live Parley</h2>
            <p className="text-xs text-slate-400">Real-time NPC voice conversations or instant tactical orders</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setTab('live')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold ${
                  tab === 'live' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                Live Voice NPC
              </button>
              <button
                type="button"
                onClick={() => setTab('tactical')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold ${
                  tab === 'tactical' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Tactical Orders
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                stopLiveSession();
                onClose();
              }}
              aria-label="Close voice overlay"
              className="p-2 rounded-lg hover:bg-white/10 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {tab === 'live' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
                disabled={liveStatus === 'connected' || liveStatus === 'connecting'}
                aria-label="Select NPC voice persona"
                className="rounded-lg bg-slate-900 border border-white/15 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-400 disabled:opacity-60"
              >
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                {liveStatus === 'connected' && (
                  <button
                    type="button"
                    onClick={interruptPlayback}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    Interrupt
                  </button>
                )}
                {liveStatus === 'connected' || liveStatus === 'connecting' ? (
                  <button
                    type="button"
                    onClick={stopLiveSession}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white flex items-center gap-1.5"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    End Voice Link
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startLiveSession()}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    Start Live Conversation
                  </button>
                )}
              </div>
            </div>

            {liveError && (
              <div className="p-2.5 rounded-lg bg-red-950/70 border border-red-400/30 text-xs text-red-200">{liveError}</div>
            )}

            <div className="h-48 overflow-y-auto rounded-xl bg-slate-950/85 border border-white/10 p-3 space-y-2 text-xs">
              {liveLog.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-center px-4">
                  Choose an Aethelgard character and click Start Live Conversation for real-time two-way spoken dialogue.
                </div>
              ) : (
                liveLog.map((line) => (
                  <div
                    key={line.id}
                    className={
                      line.speaker === 'You'
                        ? 'text-sky-300'
                        : line.speaker === 'NPC'
                          ? 'text-amber-200'
                          : 'text-slate-400 italic'
                    }
                  >
                    <strong className="mr-1.5">{line.speaker}:</strong>
                    <span>{line.text}</span>
                  </div>
                ))
              )}
            </div>

            {liveStatus === 'connected' && (
              <form onSubmit={sendLiveTextPrompt} className="flex gap-2">
                <input
                  type="text"
                  value={liveTextInput}
                  onChange={(e) => setLiveTextInput(e.target.value)}
                  placeholder="Or send a text whisper into the live session..."
                  className="flex-1 rounded-lg bg-slate-900 border border-white/15 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Speak Text
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={listening ? stopListening : startListening}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  listening
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {listening ? 'Stop Listening' : speechSupported ? 'Speak Command' : 'Use Mic / Type'}
              </button>
              <div className="text-xs text-slate-300 leading-relaxed">{feedback}</div>
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder='Type or speak: "Flank", "Cast Frost", "Negotiate Peace"...'
                aria-label="Spoken or typed dialogue prompt"
                className="flex-1 rounded-lg bg-slate-900 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                Send
              </button>
            </form>

            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setTranscript(p);
                    setFeedback(onExecuteVoiceCommand(p));
                  }}
                  className="px-2.5 py-1.5 rounded-md bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-xs text-slate-200 whitespace-nowrap"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
