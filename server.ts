import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: 'image/jpeg', base64: dataUrl };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));


  // Google Search Grounded Lore & Real-World Ecology Oracle (gemini-4-hydrogen)
  app.post('/api/search-lore', async (req, res) => {
    try {
      const { query, biomeName, season, weather } = req.body as {
        query?: string;
        biomeName?: string;
        season?: string;
        weather?: string;
      };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'Search query is required.' });
        return;
      }

      const ai = getAiClient();
      const prompt = [
        `You are the Aethelgard Scholar Oracle connecting fantasy open-world biomes to real-world natural science, history, meteorology, botany, and mythology.`,
        biomeName ? `Current player region: ${biomeName} (${season || 'Spring'}, Weather: ${weather || 'Clear'}).` : '',
        `Answer concisely and vividly with grounded real-world facts and connect it back to how a Warden can restore balance in the biome:`,
        `Query: ${query.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .map((c) => c.web)
        .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
        .map((w) => ({
          title: w.title || w.uri,
          uri: w.uri,
        }));

      res.json({
        text: response.text || 'No grounded insights returned.',
        sources,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search grounding request failed.';
      res.status(500).json({ error: message });
    }
  });

  // Dynamic Soundtrack & Boss Anthem Generation (lyria-3-clip-preview / lyria-3-pro-preview)
  app.post('/api/music', async (req, res) => {
    try {
      const { prompt, mode, imageDataUrl } = req.body as {
        prompt?: string;
        mode?: 'clip' | 'pro';
        imageDataUrl?: string;
      };
      if (!prompt || !prompt.trim()) {
        res.status(400).json({ error: 'Music prompt is required.' });
        return;
      }

      const ai = getAiClient();
      const model = mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';

      const contents = imageDataUrl
        ? {
            parts: [
              { text: prompt.trim() },
              (() => {
                const parsed = parseDataUrl(imageDataUrl);
                return { inlineData: { data: parsed.base64, mimeType: parsed.mimeType } };
              })(),
            ],
          }
        : prompt.trim();

      const response = await ai.models.generateContentStream({
        model,
        contents,
      });

      const audioChunks: Buffer[] = [];
      let lyrics = '';
      let mimeType = 'audio/mpeg';

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      if (audioChunks.length === 0) {
        res.status(500).json({ error: 'Lyria did not return an audio track.' });
        return;
      }

      const audioBase64 = Buffer.concat(audioChunks).toString('base64');
      res.json({
        audioDataUrl: `data:${mimeType};base64,${audioBase64}`,
        lyrics: lyrics.trim(),
        mimeType,
        model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Music generation failed.';
      res.status(500).json({ error: message });
    }
  });

  // Photo-to-Video Animation via Interactions API (gemini-omni-1.2-flash)
  app.post('/api/animate-video', async (req, res) => {
    try {
      const { imageDataUrl, prompt, aspectRatio, duration } = req.body as {
        imageDataUrl?: string;
        prompt?: string;
        aspectRatio?: '16:9' | '9:16';
        duration?: '5s' | '6s' | '8s' | '10s';
      };

      if (!imageDataUrl) {
        res.status(400).json({ error: 'An image is required to animate into video.' });
        return;
      }

      const ai = getAiClient();
      const parsed = parseDataUrl(imageDataUrl);
      const ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
      const motionPrompt =
        (prompt && prompt.trim()) ||
        'Hyperrealistic cinematic camera push-in with drifting atmospheric mist, golden volumetric sunbeams, and swaying foliage.';

      const interaction = await ai.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: [
            {
              type: 'image',
              mime_type: parsed.mimeType,
              data: parsed.base64,
            },
            {
              type: 'text',
              text: motionPrompt,
            },
          ],
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: ratio,
            duration: duration || '6s',
            resolution: '720p',
          },
        },
        { timeout: 300000 }
      );

      const videoPart = interaction.output_video;
      if (!videoPart || !videoPart.data) {
        res.status(500).json({ error: 'Video generation completed without video output.' });
        return;
      }

      const mimeType = videoPart.mime_type || 'video/mp4';
      res.json({
        videoDataUrl: `data:${mimeType};base64,${videoPart.data}`,
        mimeType,
        aspectRatio: ratio,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Video animation failed.';
      res.status(500).json({ error: message });
    }
  });

  const server = http.createServer(app);

  // Vite dev middlewares or production static bundle
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: hmrDisabled ? false : true,
        ws: { server },
        watch: hmrDisabled ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Bidirectional Real-Time Voice Bridge (gemini-3.8-live) on /api/live-ws
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const urlStr = req.url || '';
    if (urlStr.startsWith('/api/live-ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const reqUrl = new URL(req.url || '/api/live-ws', `http://localhost:${PORT}`);
    const persona = reqUrl.searchParams.get('persona') || 'Elder Rowan, Keeper of the Suncrest Prophecy';
    const voiceName = (reqUrl.searchParams.get('voice') || 'Charon') as
      | 'Puck'
      | 'Charon'
      | 'Kore'
      | 'Fenrir'
      | 'Zephyr';
    const worldContext = reqUrl.searchParams.get('context') || 'Kingdom of Aethelgard';

    let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let closed = false;

    try {
      const ai = getAiClient();
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          systemInstruction: `You are ${persona} inside the open-world fantasy RPG Aethelgard. Current realm context: ${worldContext}. Speak naturally, vividly, and concisely in character (2-3 sentences unless asked for deep lore). Help the Warden with quests, elemental combos (Fire+Frost = Thermal Shatter, Gale+Lightning = Overload Arc), biome restoration, and moral choices.`,
        },
        callbacks: {
          onopen: () => {
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ ready: true }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (closed || clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ inputTranscript: content.inputTranscription.text }));
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ outputTranscript: content.outputTranscription.text }));
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
          onerror: (err) => {
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  error: err instanceof Error ? err.message : 'Live session encountered an error.',
                })
              );
            }
          },
          onclose: () => {
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ closed: true }));
            }
          },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect to Gemini Live API.';
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: msg }));
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (raw) => {
      if (!session || closed) return;
      try {
        const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.text) {
          session.sendRealtimeInput({ text: msg.text });
        }
      } catch {
        // Ignore malformed frame
      }
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        session?.close();
      } catch {
        // Ignore
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Aethelgard full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
