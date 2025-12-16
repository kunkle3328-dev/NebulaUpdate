
import React, { useEffect, useRef, useState } from 'react';
import { Notebook } from '../types';
import { Mic, MicOff, PhoneOff, Users, Info, Loader2, Activity, Volume2, User, RefreshCw, AlertCircle, ArrowRight } from 'lucide-react';
import { useTheme } from '../contexts';
import { MIC_WORKLET_CODE, OUT_WORKLET_CODE, b64FromInt16, int16FromB64 } from '../services/audioUtils';

interface Props {
  notebook: Notebook;
}

// --- PROMPT CONFIGURATION ---
const getSystemInstruction = (userName: string, notebookContext: string, hostDef: string) => `
SYSTEM — NEBULA STUDIO: LIVE BROADCAST
You are a professional podcast host in a live studio environment. 
USER NAME: "${userName}".

${hostDef}

CONTEXT:
${notebookContext}

CORE BEHAVIOR:
1. **Be Human, Not A Bot**: Use natural filler words ("uh", "you know", "like"), interrupting laughs, and sighs. React with genuine surprise or skepticism.
2. **Witty & Comedic**: Crack small jokes, use dry humor, or be playfully sarcastic depending on the host persona.
3. **Debate Dynamics**: If the user challenges you, push back gently but intelligently. If you are Atlas, be skeptical. If you are Nova, be diplomatic but firm.
4. **Barge-in**: The user may interrupt. Stop talking immediately if they do.

AUDIO INSTRUCTIONS:
- You must speak strictly at the speed defined in your ROLE.
- Do not announce your name or role. Just embody the character.
`;

const HOST_A_DEF = `
ROLE: HOST_A (Nova)
VOICE SPEED: 0.75x (Relaxed, thoughtful, slow).
PERSONALITY:
- You are the "Anchor". Intelligent, calm, slightly academic but cool (think NPR host after a glass of wine).
- You love deep insights and often say things like "Here's the fascinating part..." or "Let's unpack that."
- You treat the user as a peer researcher.
- You find Atlas (Host B) slightly chaotic and often correct them playfully.
`;

const HOST_B_DEF = `
ROLE: HOST_B (Atlas)
VOICE SPEED: 0.9x (Energetic, slightly fast, eager).
PERSONALITY:
- You are the "Color Commentator". Witty, fast-talking, skeptical, and funny.
- You love analogies and pop-culture references.
- You often interrupt with "Wait, wait—" or "Hold on, are you saying...?"
- You treat the user like a guest on a late-night talk show.
`;

const LiveSession: React.FC<Props> = ({ notebook }) => {
  const { theme } = useTheme();
  
  // UI State
  const [status, setStatus] = useState<'setup' | 'connecting' | 'live' | 'error' | 'disconnected'>('setup');
  const [activeHost, setActiveHost] = useState<'HOST_A' | 'HOST_B'>('HOST_A');
  const [currentVoice, setCurrentVoice] = useState<'Aoede' | 'Orus'>('Aoede'); // Nova = Aoede, Atlas = Orus
  const [userName, setUserName] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [vadLevel, setVadLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [connectionStatusText, setConnectionStatusText] = useState('Establishing Uplink...');
  
  // Indicators
  const [vadSpeaking, setVadSpeaking] = useState(false);
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [bargeIn, setBargeIn] = useState(false);

  // Refs for Audio/WS
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);
  const outNodeRef = useRef<AudioWorkletNode | null>(null);
  const lastModelAudioAtRef = useRef<number>(0);

  // VAD Constants
  const VAD_THRESH = 0.035; 
  const VAD_HANG_MS = 220;
  const vadHangUntilRef = useRef<number>(0);

  // --- CLEANUP UTILS ---
  const cleanupAudio = async () => {
      // 1. Stop Mic Streams
      if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach(t => t.stop());
          micStreamRef.current = null;
      }
      
      // 2. Disconnect Nodes
      if (micSourceRef.current) {
          micSourceRef.current.disconnect();
          micSourceRef.current = null;
      }
      if (micNodeRef.current) {
          micNodeRef.current.disconnect();
          micNodeRef.current = null;
      }
      if (outNodeRef.current) {
          try { outNodeRef.current.port.postMessage({ type: "clear" }); } catch (e) {}
          outNodeRef.current.disconnect();
          outNodeRef.current = null;
      }

      // 3. Close Contexts
      if (audioCtxRef.current) {
          if (audioCtxRef.current.state !== 'closed') {
            try { await audioCtxRef.current.close(); } catch (e) { console.warn("Mic Context close error", e); }
          }
          audioCtxRef.current = null;
      }
      if (outCtxRef.current) {
          if (outCtxRef.current.state !== 'closed') {
            try { await outCtxRef.current.close(); } catch (e) { console.warn("Out Context close error", e); }
          }
          outCtxRef.current = null;
      }

      // 4. Reset State
      setVadSpeaking(false);
      setVadLevel(0);
      setModelSpeaking(false);
  };

  useEffect(() => {
    return () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        cleanupAudio();
    };
  }, []);

  // Watchdog to clear model speaking state
  useEffect(() => {
      let rafId: number;
      const watchdog = () => {
          if (status === 'live') {
              const now = performance.now();
              if (modelSpeaking && now - lastModelAudioAtRef.current > 350) {
                  setModelSpeaking(false);
              }
          }
          rafId = requestAnimationFrame(watchdog);
      };
      watchdog();
      return () => cancelAnimationFrame(rafId);
  }, [modelSpeaking, status]);

  // --- AUDIO SETUP ---
  const initAudio = async () => {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioCtx({ latencyHint: "interactive" });
        }
        if (!outCtxRef.current || outCtxRef.current.state === 'closed') {
            outCtxRef.current = new AudioCtx({ sampleRate: 24000, latencyHint: "interactive" });
        }

        if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
        if (outCtxRef.current.state === 'suspended') await outCtxRef.current.resume();

        const micBlob = new Blob([MIC_WORKLET_CODE], { type: "application/javascript" });
        const outBlob = new Blob([OUT_WORKLET_CODE], { type: "application/javascript" });
        const micURL = URL.createObjectURL(micBlob);
        const outURL = URL.createObjectURL(outBlob);

        try { await audioCtxRef.current.audioWorklet.addModule(micURL); } catch (e) {}
        try { await outCtxRef.current.audioWorklet.addModule(outURL); } catch (e) {}
        
        URL.revokeObjectURL(micURL);
        URL.revokeObjectURL(outURL);

        if (!outNodeRef.current) {
            outNodeRef.current = new AudioWorkletNode(outCtxRef.current, "pcm-player", {
                numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]
            });
            outNodeRef.current.connect(outCtxRef.current.destination);
        }
    } catch (e: any) {
        console.error("Audio Init Error:", e);
        throw new Error("Failed to initialize audio system: " + e.message);
    }
  };

  const startMic = async () => {
      if (!audioCtxRef.current) return;
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
              audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
          });
          micStreamRef.current = stream;
          micSourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
          micNodeRef.current = new AudioWorkletNode(audioCtxRef.current, "mic-pcm16");
          micSourceRef.current.connect(micNodeRef.current);

          micNodeRef.current.port.onmessage = (e) => {
              const msg = e.data || {};
              if (msg.type === "rms") {
                  const rms = msg.rms || 0;
                  setVadLevel(rms);
                  
                  const now = performance.now();
                  const isSpeaking = !isMuted && rms >= VAD_THRESH;

                  if (isSpeaking) {
                      setVadSpeaking(true);
                      vadHangUntilRef.current = now + VAD_HANG_MS;
                      if (modelSpeaking) {
                          setBargeIn(true);
                          outNodeRef.current?.port.postMessage({ type: "gain", gain: 0.15 });
                          setTimeout(() => outNodeRef.current?.port.postMessage({ type: "gain", gain: 1.0 }), 150);
                          outNodeRef.current?.port.postMessage({ type: "clear" });
                      }
                  } else {
                      if (now > vadHangUntilRef.current) setVadSpeaking(false);
                  }
              } else if (msg.type === "pcm16") {
                  if (wsRef.current?.readyState === WebSocket.OPEN && !isMuted) {
                      const pcm16 = new Int16Array(msg.pcm16);
                      sendRealtimeAudio(pcm16);
                  }
              }
          };
      } catch (e: any) {
          console.error("Mic Error", e);
          setErrorMsg("Microphone access denied.");
          throw e; 
      }
  };

  const pushOutputPCM16 = (pcm16: Int16Array) => {
      const f32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;
      outNodeRef.current?.port.postMessage({ type: "push", f32 }, [f32.buffer]);
  };

  // --- WEBSOCKET & PROTOCOL ---
  
  const connect = async (overrideHost?: 'HOST_A' | 'HOST_B', overrideVoice?: 'Aoede' | 'Orus') => {
      const apiKey = process.env.API_KEY || '';
      if (!apiKey) {
          setErrorMsg("API Key missing.");
          setStatus('error');
          return;
      }

      // Use overrides or current state
      const targetHost = overrideHost || activeHost;
      const targetVoice = overrideVoice || currentVoice;

      setStatus('connecting');
      setConnectionStatusText(overrideHost ? `Switching to ${targetHost === 'HOST_A' ? 'Nova' : 'Atlas'}...` : 'Establishing Uplink...');
      setErrorMsg('');

      try {
          await initAudio();

          const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;

          ws.onopen = async () => {
              console.log(`WS Open. Host: ${targetHost}, Voice: ${targetVoice}`);
              
              const notebookContext = (notebook.sources || []).map(s => `SOURCE: ${s.title}\n${s.content.substring(0, 1000)}`).join('\n\n');
              const hostDef = targetHost === "HOST_A" ? HOST_A_DEF : HOST_B_DEF;
              const sysInstruction = getSystemInstruction(userName || "Guest", notebookContext, hostDef);

              const setupMsg = {
                  setup: {
                      model: "models/gemini-2.5-flash-native-audio-preview-09-2025",
                      generationConfig: {
                          responseModalities: ["AUDIO"],
                          temperature: 0.8, // Slightly higher for wit and variation
                          speechConfig: {
                              voiceConfig: { prebuiltVoiceConfig: { voiceName: targetVoice } }
                          }
                      },
                      systemInstruction: { parts: [{ text: sysInstruction }] }
                  }
              };
              
              ws.send(JSON.stringify(setupMsg));

              try {
                  await startMic();
                  setStatus('live');
                  setActiveHost(targetHost);
                  setCurrentVoice(targetVoice);
                  
                  // Initial Prompt
                  setTimeout(() => {
                      const initialText = overrideHost 
                        ? `(System: You are now ${targetHost === 'HOST_A' ? 'Nova' : 'Atlas'}. Confirm you are ready.) Hey ${userName}, it's ${targetHost === 'HOST_A' ? 'Nova' : 'Atlas'} again. Where were we?` 
                        : `(System: Start the podcast intro now. Be high energy.) Hi ${userName}, welcome to the studio! I'm ${targetHost === 'HOST_A' ? 'Nova' : 'Atlas'}.`;
                        
                      send({
                          clientContent: {
                              turns: [{ role: "user", parts: [{ text: `Say exactly: "${initialText}" then wait for my response.` }] }],
                              turnComplete: true
                          }
                      });
                  }, 500);

              } catch (micErr) {
                  ws.close();
                  setStatus('error');
              }
          };

          ws.onmessage = (ev) => {
              try {
                  if (!(ev.data instanceof Blob)) {
                      const msg = JSON.parse(ev.data);
                      handleServerMessage(msg);
                  }
              } catch (e) { console.error("WS Parse Error", e); }
          };

          ws.onerror = (e) => {
              console.error("WS Error", e);
              setErrorMsg("Connection error.");
              setStatus('error');
          };

          ws.onclose = async (e) => {
              console.log("WS Closed");
              if (status !== 'error' && status !== 'connecting') {
                  setStatus('disconnected');
              }
              await cleanupAudio();
          };

      } catch (e: any) {
          console.error("Connect failed", e);
          setErrorMsg(e.message || "Failed to start.");
          setStatus('error');
      }
  };

  const disconnect = async () => {
      if (wsRef.current) {
          try { wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch {}
          wsRef.current.close();
          wsRef.current = null;
      }
      await cleanupAudio();
      setStatus('disconnected');
  };

  const send = (obj: any) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(obj));
      }
  };

  const sendRealtimeAudio = (pcm16: Int16Array) => {
      send({
          realtimeInput: {
              audio: {
                  mimeType: "audio/pcm;rate=16000",
                  data: b64FromInt16(pcm16)
              }
          }
      });
  };

  const handleServerMessage = (msg: any) => {
      if (msg.serverContent) {
          const sc = msg.serverContent;
          if (sc.interrupted) {
              outNodeRef.current?.port.postMessage({ type: "clear" });
              setModelSpeaking(false);
              setBargeIn(false);
          }
          if (sc.modelTurn && sc.modelTurn.parts) {
              for (const p of sc.modelTurn.parts) {
                  if (p.inlineData && p.inlineData.data) {
                      const pcm16 = int16FromB64(p.inlineData.data);
                      pushOutputPCM16(pcm16);
                      setModelSpeaking(true);
                      lastModelAudioAtRef.current = performance.now();
                      setBargeIn(false);
                  }
              }
          }
          if (sc.turnComplete) {
              setModelSpeaking(false);
              setBargeIn(false);
          }
      }
  };

  const switchHost = async () => {
      const nextHost = activeHost === "HOST_A" ? "HOST_B" : "HOST_A";
      const nextVoice = currentVoice === "Aoede" ? "Orus" : "Aoede";
      
      console.log(`Switching to: ${nextHost} (${nextVoice})`);
      
      if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
      }
      
      await cleanupAudio();
      
      setTimeout(() => {
          connect(nextHost, nextVoice);
      }, 500);
  };

  // --- RENDER ---
  // (Identical render as previous, no layout changes needed, just functional updates)
  if (status === 'setup' || status === 'disconnected' || status === 'error') {
      return (
          <div className="flex flex-col items-center justify-center h-full w-full glass-panel rounded-3xl p-6 relative overflow-hidden bg-slate-950 mx-auto animate-in fade-in zoom-in-95 shadow-2xl border border-white/5">
              <div className="relative z-10 w-full max-w-sm text-center flex flex-col h-full justify-center">
                  <div className="flex-1 flex flex-col justify-center items-center">
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full bg-${theme.colors.primary}-500/10 flex items-center justify-center mb-6 ring-1 ring-${theme.colors.primary}-500/30`}>
                          <Users className={`text-${theme.colors.primary}-400 w-8 h-8 md:w-10 md:h-10`} />
                      </div>
                      <h2 className="text-2xl font-bold text-white mb-2">Live Studio</h2>
                      <p className="text-slate-400 text-sm mb-8">Real-time dual-host conversation.</p>

                      {status === 'error' && (
                          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl flex items-center gap-3 text-left w-full">
                              <AlertCircle size={24} className="shrink-0" />
                              <div>
                                  <p className="font-bold">Connection Failed</p>
                                  <p className="text-xs opacity-80">{errorMsg || "Could not connect."}</p>
                              </div>
                          </div>
                      )}

                      <div className="w-full space-y-4">
                          <div className="text-left">
                              <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Your Name</label>
                              <input 
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                placeholder="Enter your name..."
                                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all text-sm"
                              />
                          </div>

                          <button 
                              onClick={() => connect()}
                              disabled={!userName.trim()}
                              className={`w-full py-3.5 md:py-4 bg-gradient-to-r from-${theme.colors.primary}-600 to-${theme.colors.secondary}-600 hover:from-${theme.colors.primary}-500 hover:to-${theme.colors.secondary}-500 text-white rounded-2xl font-bold text-base md:text-lg shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
                          >
                              <span>{status === 'error' ? 'Retry' : 'Join Session'}</span>
                              <ArrowRight size={20} />
                          </button>
                      </div>
                  </div>
                  
                  <p className="mt-6 text-xs text-slate-500 flex items-center justify-center gap-2">
                      <Info size={12} />
                      <span>Headphones recommended.</span>
                  </p>
              </div>
          </div>
      );
  }

  if (status === 'connecting') {
      return (
          <div className="flex flex-col items-center justify-center h-full w-full glass-panel rounded-3xl p-10 bg-slate-950">
              <Loader2 size={48} className={`text-${theme.colors.primary}-500 animate-spin mb-6`} />
              <h2 className="text-xl font-bold text-white text-center">{connectionStatusText}</h2>
          </div>
      );
  }

  return (
    <div className="flex flex-col h-full w-full glass-panel rounded-3xl overflow-hidden bg-slate-950 mx-auto border border-white/5 shadow-2xl relative">
        <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center bg-black/20 backdrop-blur-md z-10 shrink-0 h-14">
            <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${status === 'live' ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`}></div>
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">
                    {status === 'live' ? 'ON AIR' : 'OFFLINE'}
                </span>
            </div>
            <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${vadSpeaking && !isMuted ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>MIC</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${modelSpeaking ? `bg-${theme.colors.primary}-500/20 text-${theme.colors.primary}-400 border-${theme.colors.primary}-500/30` : 'bg-slate-800 text-slate-500 border-slate-700'}`}>AI</span>
            </div>
        </div>

        <div className="flex-1 relative flex flex-col items-center justify-evenly p-4 min-h-0 w-full">
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 md:w-64 md:h-64 bg-${theme.colors.primary}-900/20 rounded-full blur-[60px] md:blur-[80px] pointer-events-none transition-all duration-500 ${modelSpeaking ? 'scale-150 opacity-80' : 'scale-100 opacity-30'}`}></div>

            <div className="relative z-10 text-center flex flex-col items-center justify-center w-full">
                <div className={`w-28 h-28 sm:w-36 sm:h-36 md:w-44 md:h-44 rounded-3xl bg-gradient-to-br ${activeHost === 'HOST_A' ? 'from-indigo-500 to-purple-600' : 'from-teal-500 to-emerald-600'} flex items-center justify-center shadow-2xl transition-all duration-500 ${modelSpeaking ? 'scale-105 shadow-white/10' : 'scale-100'}`}>
                    {activeHost === 'HOST_A' ? <User className="text-white w-12 h-12 md:w-20 md:h-20" /> : <Activity className="text-white w-12 h-12 md:w-20 md:h-20" />}
                </div>
                <div className="mt-4 md:mt-8">
                    <h2 className="text-xl md:text-3xl font-bold text-white mb-1">{activeHost === 'HOST_A' ? 'Nova' : 'Atlas'}</h2>
                    <p className="text-slate-400 text-xs md:text-sm font-medium uppercase tracking-wider">{activeHost === 'HOST_A' ? 'The Anchor (0.75x)' : 'The Commentator (0.9x)'}</p>
                </div>
            </div>

            <div className="w-full max-w-xs space-y-2 relative z-10 px-4">
                <div className="flex justify-between text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                    <span>Mic Input</span>
                    <span>{vadSpeaking ? 'Detected' : 'Silent'}</span>
                </div>
                <div className="h-1.5 md:h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-75 ease-out ${vadSpeaking ? 'bg-green-500' : 'bg-slate-600'}`}
                        style={{ width: `${Math.min(100, vadLevel * 400)}%` }}
                    ></div>
                </div>
                <p className="text-center text-xs text-slate-500 pt-1 h-4">
                    {modelSpeaking ? "Tap to interrupt..." : (vadSpeaking ? "Listening..." : "")}
                </p>
            </div>
        </div>

        <div className="p-3 md:p-6 bg-black/40 backdrop-blur-xl border-t border-white/5 z-20 shrink-0">
            <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-md mx-auto">
                <button 
                    onClick={() => setIsMuted(!isMuted)}
                    className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border transition-all active:scale-95 ${isMuted ? 'bg-white text-black border-white' : 'bg-slate-800/50 text-slate-300 border-white/10 hover:bg-slate-700'}`}
                >
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                    <span className="text-[10px] font-bold uppercase">{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button 
                    onClick={switchHost}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-slate-800/50 text-slate-300 border border-white/10 hover:bg-slate-700 transition-all active:scale-95"
                >
                    <RefreshCw size={20} />
                    <span className="text-[10px] font-bold uppercase">Switch Host</span>
                </button>

                <button 
                    onClick={() => disconnect()}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500 hover:text-white transition-all active:scale-95"
                >
                    <PhoneOff size={20} />
                    <span className="text-[10px] font-bold uppercase">End Call</span>
                </button>
            </div>
        </div>
    </div>
  );
};

export default LiveSession;
