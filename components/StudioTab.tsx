
import React, { useState, useRef, useEffect } from 'react';
import { Notebook, Artifact, AudioOverviewDialogue } from '../types';
import { useTheme, useJobs } from '../contexts';
import { Play, Pause, Headphones, Wand2, Mic, FileText, Layout, Zap, Trash2, RefreshCw, Box, FileQuestion, ChevronDown, ChevronUp, Grid2X2, ListOrdered, HelpCircle, RotateCcw, RotateCw, Loader2, PlayCircle, MoreHorizontal, X, ArrowRight, ArrowLeft } from 'lucide-react';
import LiveSession from './LiveSession';
import AudioOverviewPanel from './AudioOverviewPanel';
import { synthesizeDialogueAudio } from '../services/audioOverview';

interface Props {
  notebook: Notebook;
  onUpdate: (nb: Notebook) => void;
}

const getThemeHex = (colorName: string): string => {
    const colors: Record<string, string> = {
        slate: '#94a3b8', gray: '#9ca3af', zinc: '#a1a1aa', neutral: '#a3a3a3', stone: '#a8a29e',
        red: '#f87171', orange: '#fb923c', amber: '#fbbf24', yellow: '#facc15', lime: '#a3e635',
        green: '#4ade80', emerald: '#34d399', teal: '#2dd4bf', cyan: '#22d3ee', sky: '#38bdf8',
        blue: '#60a5fa', indigo: '#818cf8', violet: '#a78bfa', purple: '#c084fc', fuchsia: '#e879f9',
        pink: '#f472b6', rose: '#fb7185'
    };
    return colors[colorName] || '#60a5fa';
};

// --- SUB-COMPONENT: ARTIFACT RENDERER ---
const ArtifactRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
    const { theme } = useTheme();
    const data = artifact.content;
    const [index, setIndex] = useState(0); // For slides/cards
    const [flipped, setFlipped] = useState(false); // For flashcards

    if (!data) return <div className="text-slate-500">No content available.</div>;

    // 1. FLASHCARDS
    if (artifact.type === 'flashcards' && data.cards) {
        const card = data.cards[index];
        return (
            <div className="flex flex-col items-center h-full w-full max-w-2xl mx-auto px-4">
                <div 
                    className="w-full h-64 md:h-96 perspective-1000 cursor-pointer mb-6"
                    onClick={() => setFlipped(!flipped)}
                >
                    <div className={`relative w-full h-full duration-500 preserve-3d transition-transform ${flipped ? 'rotate-y-180' : ''}`}>
                        {/* Front */}
                        <div className={`absolute inset-0 backface-hidden p-6 md:p-8 rounded-3xl bg-${theme.colors.primary}-900/20 border border-${theme.colors.primary}-500/30 flex flex-col items-center justify-center text-center shadow-xl`}>
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">{card.tag || 'Term'}</span>
                            <h3 className="text-xl md:text-3xl font-bold text-white overflow-y-auto max-h-[70%] custom-scrollbar">{card.front}</h3>
                            <p className="absolute bottom-6 text-xs text-slate-400">Click to flip</p>
                        </div>
                        {/* Back */}
                        <div className={`absolute inset-0 backface-hidden rotate-y-180 p-6 md:p-8 rounded-3xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-center shadow-xl`}>
                            <div className="overflow-y-auto max-h-full custom-scrollbar w-full">
                                <p className="text-base md:text-xl text-slate-200 leading-relaxed">{card.back}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-6">
                    <button onClick={() => { setIndex(Math.max(0, index - 1)); setFlipped(false); }} disabled={index === 0} className="p-3 rounded-full bg-slate-800 disabled:opacity-50 hover:bg-slate-700 transition-colors"><ArrowLeft/></button>
                    <span className="font-mono text-sm text-slate-400">{index + 1} / {data.cards.length}</span>
                    <button onClick={() => { setIndex(Math.min(data.cards.length - 1, index + 1)); setFlipped(false); }} disabled={index === data.cards.length - 1} className="p-3 rounded-full bg-slate-800 disabled:opacity-50 hover:bg-slate-700 transition-colors"><ArrowRight/></button>
                </div>
            </div>
        );
    }

    // 2. QUIZ
    if (artifact.type === 'quiz' && data.questions) {
         const q = data.questions[index];
         const [selected, setSelected] = useState<number | null>(null);
         const [showAnswer, setShowAnswer] = useState(false);

         useEffect(() => { setSelected(null); setShowAnswer(false); }, [index]);

         return (
             <div className="max-w-2xl mx-auto h-full flex flex-col px-4">
                 <div className="mb-6">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Question {index + 1} of {data.questions.length}</span>
                    <h3 className="text-lg md:text-2xl font-bold text-white mt-2 leading-snug">{q.question}</h3>
                 </div>
                 <div className="space-y-3 mb-6 flex-1 overflow-y-auto custom-scrollbar">
                    {q.options.map((opt: string, i: number) => (
                        <button
                            key={i}
                            onClick={() => setSelected(i)}
                            disabled={showAnswer}
                            className={`w-full p-4 rounded-xl text-left border transition-all text-sm md:text-base ${
                                showAnswer 
                                ? (i === q.correctAnswerIndex ? 'bg-green-500/20 border-green-500 text-green-100' : (selected === i ? 'bg-red-500/20 border-red-500 text-red-100' : 'bg-slate-900 border-slate-800 text-slate-500'))
                                : (selected === i ? `bg-${theme.colors.primary}-600 border-${theme.colors.primary}-500 text-white` : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800')
                            }`}
                        >
                            <span className="font-bold mr-3 opacity-50">{String.fromCharCode(65 + i)}.</span>
                            {opt}
                        </button>
                    ))}
                 </div>
                 {showAnswer && (
                     <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 mb-6 animate-in fade-in">
                         <p className="text-sm text-slate-300"><span className="font-bold text-white">Explanation:</span> {q.explanation}</p>
                     </div>
                 )}
                 <div className="mt-auto flex justify-between pt-4 border-t border-white/5">
                     {!showAnswer ? (
                         <button onClick={() => setShowAnswer(true)} disabled={selected === null} className="px-6 py-2 bg-white text-black font-bold rounded-lg disabled:opacity-50">Check Answer</button>
                     ) : (
                         <button onClick={() => setIndex(Math.min(data.questions.length - 1, index + 1))} disabled={index === data.questions.length - 1} className={`px-6 py-2 bg-${theme.colors.primary}-600 text-white font-bold rounded-lg`}>Next Question</button>
                     )}
                 </div>
             </div>
         );
    }

    // 3. SLIDE DECK
    if (artifact.type === 'slideDeck' && data.slides) {
        const slide = data.slides[index];
        return (
            <div className="h-full flex flex-col px-2 md:px-8">
                <div className="flex-1 bg-white text-black p-6 md:p-12 rounded-xl shadow-2xl overflow-y-auto mb-6 relative min-h-[400px]">
                    <div className={`absolute top-0 left-0 w-full h-2 bg-${theme.colors.primary}-600`}></div>
                    <h2 className="text-2xl md:text-4xl font-bold mb-6 md:mb-8 leading-tight">{slide.slideTitle}</h2>
                    <ul className="space-y-3 md:space-y-4">
                        {slide.bullets?.map((b: string, i: number) => (
                            <li key={i} className="text-base md:text-xl flex items-start gap-3">
                                <span className={`mt-2 w-2 h-2 rounded-full bg-${theme.colors.primary}-600 shrink-0`}></span>
                                {b}
                            </li>
                        ))}
                    </ul>
                    <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-gray-200 text-xs md:text-sm text-gray-500 font-mono">
                        SPEAKER NOTES: {slide.speakerNotes}
                    </div>
                </div>
                <div className="flex items-center justify-center gap-6">
                    <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} className="p-3 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50"><ArrowLeft/></button>
                    <span className="font-mono text-sm text-slate-400">Slide {index + 1} / {data.slides.length}</span>
                    <button onClick={() => setIndex(Math.min(data.slides.length - 1, index + 1))} disabled={index === data.slides.length - 1} className="p-3 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50"><ArrowRight/></button>
                </div>
            </div>
        );
    }

    // 4. LIST BASED (Roadmap, SWOT, Brief)
    return (
        <div className="max-w-3xl mx-auto h-full overflow-y-auto custom-scrollbar p-1 px-4">
            {Object.entries(data).map(([key, value]) => {
                if (key === 'title' || key === 'briefTitle') return <h2 key={key} className="text-2xl md:text-3xl font-bold text-white mb-6 leading-tight">{value as string}</h2>;
                if (typeof value === 'string') return <p key={key} className="text-slate-300 mb-6 leading-relaxed bg-slate-900/50 p-4 rounded-xl border border-white/5">{value}</p>;
                if (Array.isArray(value)) {
                    return (
                        <div key={key} className="mb-8">
                            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">{key.replace(/([A-Z])/g, ' $1').trim()}</h3>
                            <div className="space-y-3">
                                {value.map((item: any, i: number) => {
                                    if (typeof item === 'string') return <div key={i} className="p-3 bg-slate-800/50 rounded-lg border border-white/5 text-slate-200">{item}</div>;
                                    return (
                                        <div key={i} className="p-4 bg-slate-900 rounded-xl border border-white/10 shadow-sm">
                                            {Object.entries(item).map(([k, v]) => (
                                                <div key={k} className="mb-1 last:mb-0">
                                                    <span className="text-xs text-slate-500 uppercase font-bold mr-2 block md:inline">{k}:</span>
                                                    <span className="text-slate-200">{String(v)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                }
                return null;
            })}
        </div>
    );
};


const StudioTab: React.FC<Props> = ({ notebook, onUpdate }) => {
  const { theme } = useTheme();
  const { startJob, jobs } = useJobs();
  
  const [activeView, setActiveView] = useState<'audio' | 'live' | 'lab'>('audio');
  
  // Audio Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  
  // Artifact Viewing
  const [viewingArtifact, setViewingArtifact] = useState<Artifact | null>(null);
  const [generatingType, setGeneratingType] = useState<Artifact['type'] | null>(null);
  const [dims, setDims] = useState({ canvasSize: 320, artSize: 140 });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // ... (Keep existing resize, audio context logic, etc.) ...
  useEffect(() => {
    const updateDims = () => {
        if (window.innerWidth < 640) {
            setDims({ canvasSize: 300, artSize: 140 });
        } else {
            setDims({ canvasSize: 420, artSize: 200 });
        }
    };
    window.addEventListener('resize', updateDims);
    updateDims();
    return () => window.removeEventListener('resize', updateDims);
  }, []);

  const audioArtifact = (notebook.artifacts || []).find(a => a.type === 'audioOverview');
  const isGeneratingArtifact = jobs.some(j => j.notebookId === notebook.id && j.type !== 'audioOverview' && j.status === 'processing');
  
  // Helper to parse Audio Content safely
  const audioContent = audioArtifact?.content as AudioOverviewDialogue | undefined;
  const audioUrl = audioContent?.audioUrl || (audioArtifact?.content?.audioUrl as string);
  const title = audioArtifact?.title;
  const coverUrl = audioContent?.coverUrl || (audioArtifact?.content?.coverUrl as string);
  const scriptText = audioContent?.turns 
    ? audioContent.turns.map(t => `${t.speaker}: ${t.text}`).join('\n\n')
    : (audioArtifact?.content?.script as string) || "";

  // ... (Keep existing initAudioContext, drawVisualizer, togglePlay, skip, formatTime) ...
  useEffect(() => {
    return () => {
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
    };
  }, []);

  const initAudioContext = () => {
      if (!audioRef.current) return;
      if (!audioContextRef.current) {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          audioContextRef.current = new AudioCtx();
      }
      if (!analyserRef.current) {
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 256; 
          analyserRef.current.smoothingTimeConstant = 0.85;
      }
      if (!sourceNodeRef.current) {
          sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
          sourceNodeRef.current.connect(analyserRef.current);
          analyserRef.current.connect(audioContextRef.current.destination);
      }
  };

  const drawVisualizer = () => {
      if (!canvasRef.current || !analyserRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = dims.artSize / 2 + 10; 
      const bars = 80; 
      const step = (Math.PI * 2) / bars;
      const primaryHex = getThemeHex(theme.colors.primary);
      const secondaryHex = getThemeHex(theme.colors.secondary);
      ctx.shadowBlur = 10;
      ctx.shadowColor = primaryHex;

      for (let i = 0; i < bars; i++) {
          const dataIndex = Math.floor(i * (bufferLength / 2) / bars);
          const value = dataArray[dataIndex] || 0;
          const percent = value / 255;
          const height = Math.pow(percent, 2) * 60; 
          const barHeight = Math.max(2, height);
          const angle = i * step - (Math.PI / 2);
          const x1 = centerX + Math.cos(angle) * baseRadius;
          const y1 = centerY + Math.sin(angle) * baseRadius;
          const x2 = centerX + Math.cos(angle) * (baseRadius + barHeight);
          const y2 = centerY + Math.sin(angle) * (baseRadius + barHeight);
          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, primaryHex);
          gradient.addColorStop(1, secondaryHex);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.stroke();
      }
      animationRef.current = requestAnimationFrame(drawVisualizer);
  };

  const togglePlay = () => {
      if (!audioRef.current || !audioUrl) return;
      initAudioContext();
      if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
      if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
          if (animationRef.current) cancelAnimationFrame(animationRef.current);
      } else {
          audioRef.current.play();
          setIsPlaying(true);
          drawVisualizer();
      }
  };

  const skip = (seconds: number) => {
      if (audioRef.current) audioRef.current.currentTime += seconds;
  };
  
  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSaveArtifact = (artifact: Artifact) => {
      const updated = {
          ...notebook,
          artifacts: [artifact, ...(notebook.artifacts || [])].filter((a, i, self) => i === self.findIndex((t) => t.id === a.id)),
          updatedAt: Date.now()
      };
      onUpdate(updated);
  };

  const handleSynthesizeAudio = async () => {
    if (!audioContent || isSynthesizing || !audioArtifact) return;
    setIsSynthesizing(true);
    try {
        const result = await synthesizeDialogueAudio(audioContent, (audioContent as any).voiceConfig);
        const updatedArtifact: Artifact = {
            ...audioArtifact,
            content: {
                ...audioContent,
                audioUrl: result.audioUrl,
                coverUrl: result.coverUrl
            }
        };
        handleSaveArtifact(updatedArtifact);
    } catch (e) {
        console.error("Synthesis failed", e);
        alert("Failed to synthesize audio. Please try again.");
    } finally {
        setIsSynthesizing(false);
    }
  };

  const handleGenerateArtifact = async (type: Artifact['type']) => {
      if ((notebook.sources || []).length === 0) return;
      setGeneratingType(type);
      await startJob(notebook.id, type, notebook.sources);
      setGeneratingType(null);
  };

  const handleDeleteArtifact = (id: string) => {
      const updated = {
          ...notebook,
          artifacts: (notebook.artifacts || []).filter(a => a.id !== id)
      };
      onUpdate(updated);
  };
  
  const getArtifactIcon = (type: Artifact['type']) => {
      switch(type) {
          case 'flashcards': return <RefreshCw size={18} />;
          case 'quiz': return <FileQuestion size={18} />;
          case 'infographic': return <Layout size={18} />;
          case 'slideDeck': return <Box size={18} />;
          case 'executiveBrief': return <FileText size={18} />;
          case 'swotAnalysis': return <Grid2X2 size={18} />;
          case 'projectRoadmap': return <ListOrdered size={18} />;
          case 'faqGuide': return <HelpCircle size={18} />;
          default: return <Zap size={18} />;
      }
  };

  const renderScript = () => {
      if (!scriptText) return null;
      return scriptText.split('\n').filter(line => line.trim() !== '').map((line, idx) => {
          const isJoe = line.startsWith('Joe:') || line.startsWith('Atlas:');
          const isJane = line.startsWith('Jane:') || line.startsWith('Nova:');
          const speaker = isJoe ? (line.startsWith('Joe:') ? 'Joe' : 'Atlas') : isJane ? (line.startsWith('Jane:') ? 'Jane' : 'Nova') : '';
          const text = speaker ? line.replace(`${speaker}:`, '').trim() : line;
          return (
              <div 
                key={idx} 
                className={`mb-4 p-4 rounded-xl border border-white/5 transition-colors duration-500
                ${isJoe ? `bg-${theme.colors.primary}-900/20 border-${theme.colors.primary}-500/20` : 
                  isJane ? `bg-${theme.colors.secondary}-900/20 border-${theme.colors.secondary}-500/20` : 'bg-white/5'}`}
              >
                  {speaker && (
                      <div className={`text-xs font-bold uppercase mb-1 flex items-center gap-2 ${isJoe ? `text-${theme.colors.primary}-400` : `text-${theme.colors.secondary}-400`}`}>
                          {isJoe ? <Mic size={12} /> : <Headphones size={12} />}
                          {speaker}
                      </div>
                  )}
                  <p className="text-slate-200 text-sm leading-relaxed">{text}</p>
              </div>
          );
      });
  };

  return (
    <div className="flex flex-col h-full gap-6">
        <div className="flex items-center justify-center p-1 bg-white/5 rounded-2xl self-center border border-white/5 shadow-inner">
            <button 
                onClick={() => setActiveView('audio')}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeView === 'audio' ? `bg-${theme.colors.primary}-600 text-white shadow-lg` : 'text-slate-400 hover:text-white'}`}
            >
                <Headphones size={16} /> Audio Overview
            </button>
            <button 
                onClick={() => setActiveView('live')}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeView === 'live' ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
                <Mic size={16} /> Live Session
            </button>
            <button 
                onClick={() => setActiveView('lab')}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeView === 'lab' ? `bg-${theme.colors.secondary}-600 text-white shadow-lg` : 'text-slate-400 hover:text-white'}`}
            >
                <Wand2 size={16} /> Knowledge Lab
            </button>
        </div>

        <div className="flex-1 overflow-y-auto">
            {activeView === 'live' && (
                <div className="max-w-3xl mx-auto h-full flex flex-col justify-center animate-in fade-in slide-in-from-bottom-4">
                    <LiveSession notebook={notebook} />
                </div>
            )}

            {activeView === 'audio' && (
                <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 h-full">
                    {audioArtifact ? (
                        <div className="flex flex-col items-center justify-center relative min-h-[450px] p-6 md:p-12 glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-2xl transition-all duration-500">
                            {/* IF AUDIO EXISTS: SHOW PREMIUM PLAYER */}
                            {audioUrl ? (
                                <>
                                    <div className="w-full flex flex-col items-center justify-center relative z-10">
                                        <audio 
                                            ref={audioRef} 
                                            src={audioUrl} 
                                            onEnded={() => setIsPlaying(false)} 
                                            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                                            crossOrigin="anonymous" 
                                        />
                                        
                                        {/* Visualizer & Cover Art Container */}
                                        <div className="relative flex items-center justify-center shrink-0 mb-10 mt-4 transition-all duration-500" style={{ width: dims.canvasSize, height: dims.canvasSize }}>
                                            {/* Canvas Layer */}
                                            <canvas 
                                                ref={canvasRef} 
                                                width={dims.canvasSize} 
                                                height={dims.canvasSize} 
                                                className="absolute inset-0 z-10 pointer-events-none opacity-80" 
                                            />
                                            
                                            {/* Cover Art Layer */}
                                            <div 
                                                className={`relative rounded-full overflow-hidden z-20 shadow-[0_0_60px_rgba(0,0,0,0.5)] border-4 border-white/10 transition-transform duration-[2s] ease-linear ${isPlaying ? 'scale-105' : 'scale-100'}`} 
                                                style={{ width: dims.artSize, height: dims.artSize }}
                                            >
                                                {coverUrl ? (
                                                    <img src={coverUrl} alt="Cover" className="w-full h-full object-cover animate-in fade-in duration-700" />
                                                ) : (
                                                    <div className={`w-full h-full bg-gradient-to-br from-${theme.colors.primary}-900 to-slate-950 flex items-center justify-center`}>
                                                        <Headphones size={dims.artSize * 0.4} className={`text-${theme.colors.primary}-400 opacity-50`} />
                                                    </div>
                                                )}
                                                {/* Gloss Overlay */}
                                                <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent pointer-events-none rounded-full"></div>
                                            </div>
                                        </div>
                                        
                                        {/* Title & Metadata */}
                                        <div className="text-center z-20 px-4 w-full max-w-md mx-auto flex flex-col gap-2 mb-8">
                                            <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight drop-shadow-xl">{title || "Audio Overview"}</h2>
                                            <p className="text-sm text-slate-400 font-medium tracking-wide uppercase">AI Generated • {notebook.title}</p>
                                        </div>

                                        {/* Progress Bar */}
                                        <div className="w-full max-w-lg z-30 mb-8 px-4 flex items-center gap-4 text-xs font-bold text-slate-400 font-mono">
                                            <span className="min-w-[40px] text-right">{formatTime(currentTime)}</span>
                                            <div className="flex-1 relative h-2 bg-white/10 rounded-full overflow-hidden group cursor-pointer">
                                                <div 
                                                    className={`absolute top-0 left-0 h-full bg-gradient-to-r from-${theme.colors.primary}-500 to-${theme.colors.secondary}-500 transition-all duration-100 ease-linear rounded-full`}
                                                    style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                                                ></div>
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={duration || 100}
                                                    value={currentTime}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value);
                                                        setCurrentTime(val);
                                                        if(audioRef.current) audioRef.current.currentTime = val;
                                                    }}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                />
                                            </div>
                                            <span className="min-w-[40px] text-left">{formatTime(duration)}</span>
                                        </div>

                                        {/* Main Controls - Frosted Glass */}
                                        <div className="flex items-center justify-center gap-6 md:gap-10 z-30">
                                            <button 
                                                onClick={() => skip(-10)} 
                                                className="group relative p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 backdrop-blur-md transition-all hover:scale-110 active:scale-95 shadow-lg"
                                                title="Rewind 10s"
                                            >
                                                <RotateCcw size={22} className="text-slate-300 group-hover:text-white" />
                                            </button>
                                            
                                            <button 
                                                onClick={togglePlay} 
                                                className={`group relative w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5 border border-white/20 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-all hover:scale-105 active:scale-95`}
                                            >
                                                <div className={`absolute inset-0 rounded-full bg-gradient-to-br from-${theme.colors.primary}-500/20 to-${theme.colors.secondary}-500/20 opacity-0 group-hover:opacity-100 transition-opacity blur-md`}></div>
                                                {isPlaying ? (
                                                    <Pause fill="white" size={32} className="text-white relative z-10" /> 
                                                ) : (
                                                    <Play fill="white" size={32} className="text-white ml-2 relative z-10" />
                                                )}
                                            </button>
                                            
                                            <button 
                                                onClick={() => skip(10)} 
                                                className="group relative p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 backdrop-blur-md transition-all hover:scale-110 active:scale-95 shadow-lg"
                                                title="Forward 10s"
                                            >
                                                <RotateCw size={22} className="text-slate-300 group-hover:text-white" />
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-center p-12 space-y-6 animate-in fade-in zoom-in-95">
                                    <div className={`w-24 h-24 rounded-3xl bg-gradient-to-br from-${theme.colors.primary}-900/50 to-slate-900 flex items-center justify-center border border-${theme.colors.primary}-500/30 shadow-2xl`}>
                                        <FileText size={48} className={`text-${theme.colors.primary}-400 drop-shadow-lg`} />
                                    </div>
                                    <div>
                                        <h2 className="text-3xl font-bold text-white mb-2">Script Ready</h2>
                                        <p className="text-slate-400 max-w-md mx-auto text-lg leading-relaxed">The dialogue script has been generated. Synthesize the audio to listen to the conversation.</p>
                                    </div>
                                    <button 
                                        onClick={handleSynthesizeAudio}
                                        disabled={isSynthesizing}
                                        className={`px-10 py-5 bg-gradient-to-r from-${theme.colors.primary}-600 to-${theme.colors.secondary}-600 hover:from-${theme.colors.primary}-500 hover:to-${theme.colors.secondary}-500 text-white rounded-2xl font-bold text-lg shadow-xl shadow-${theme.colors.primary}-900/20 flex items-center gap-3 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100`}
                                    >
                                        {isSynthesizing ? <Loader2 className="animate-spin" size={24} /> : <PlayCircle size={24} />}
                                        {isSynthesizing ? 'Synthesizing Voices...' : 'Generate Audio Now'}
                                    </button>
                                </div>
                            )}

                            <div className="mt-12 flex flex-col items-center gap-4 relative z-20 w-full border-t border-white/5 pt-8">
                                <div className="flex gap-4">
                                    <button onClick={() => handleDeleteArtifact(audioArtifact.id)} className="px-5 py-2.5 bg-white/5 hover:bg-rose-500/20 rounded-full text-xs font-bold text-rose-400 flex items-center gap-2 border border-white/10 transition-colors">
                                        <Trash2 size={14} /> Delete
                                    </button>
                                </div>
                                {scriptText && (
                                    <div className="w-full max-w-2xl mt-4">
                                        <button onClick={() => setShowTranscript(!showTranscript)} className="mx-auto flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors uppercase tracking-wider mb-4 px-4 py-2 hover:bg-white/5 rounded-full">
                                            {showTranscript ? 'Hide Transcript' : 'Show Transcript'}
                                            {showTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </button>
                                        {showTranscript && <div className="bg-black/40 border border-white/10 rounded-2xl p-8 text-left max-h-[500px] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-2">{renderScript()}</div>}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <AudioOverviewPanel notebook={notebook} onSaveArtifact={handleSaveArtifact} />
                    )}
                </div>
            )}

            {activeView === 'lab' && (
                <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {[
                            { id: 'flashcards', label: 'Flashcards', icon: RefreshCw },
                            { id: 'quiz', label: 'Practice Quiz', icon: FileQuestion },
                            { id: 'infographic', label: 'Infographic', icon: Layout },
                            { id: 'slideDeck', label: 'Slide Deck', icon: Box },
                            { id: 'executiveBrief', label: 'Exec Brief', icon: FileText },
                            { id: 'swotAnalysis', label: 'SWOT Analysis', icon: Grid2X2 },
                            { id: 'projectRoadmap', label: 'Project Roadmap', icon: ListOrdered },
                            { id: 'faqGuide', label: 'FAQ Guide', icon: HelpCircle }
                        ].map((item) => (
                            <button
                                key={item.id}
                                onClick={() => handleGenerateArtifact(item.id as Artifact['type'])}
                                disabled={isGeneratingArtifact}
                                className={`p-4 glass-panel rounded-xl flex flex-col items-center gap-3 border border-white/5 hover:bg-white/5 transition-all group ${generatingType === item.id ? 'opacity-50' : ''}`}
                            >
                                <div className={`p-3 rounded-full bg-${theme.colors.primary}-500/10 text-${theme.colors.primary}-400 group-hover:scale-110 transition-transform`}>
                                    <item.icon size={24} />
                                </div>
                                <span className="text-sm font-bold text-slate-300">{item.label}</span>
                            </button>
                        ))}
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(notebook.artifacts || []).filter(a => a.type !== 'audioOverview').map((artifact) => (
                            <div key={artifact.id} className="glass-panel p-5 rounded-xl border border-white/5 flex items-start gap-4 group">
                                <div className={`p-3 rounded-lg bg-slate-800 text-${theme.colors.primary}-400`}>
                                    {getArtifactIcon(artifact.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-bold text-slate-200 truncate">{artifact.title}</h4>
                                    <p className="text-xs text-slate-500 mt-1 capitalize">{artifact.status} • {new Date(artifact.createdAt).toLocaleDateString()}</p>
                                    {artifact.status === 'completed' && (
                                        <div className="mt-3 flex gap-2">
                                            <button onClick={() => setViewingArtifact(artifact)} className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg text-white transition-colors">{artifact.type === 'slideDeck' ? 'Present' : 'View'}</button>
                                        </div>
                                    )}
                                </div>
                                <button onClick={() => handleDeleteArtifact(artifact.id)} className="p-2 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={16} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* ARTIFACT VIEWING MODAL */}
        {viewingArtifact && (
            <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[200] flex flex-col animate-in fade-in">
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl bg-${theme.colors.primary}-900/50 text-${theme.colors.primary}-400`}>
                            {getArtifactIcon(viewingArtifact.type)}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">{viewingArtifact.title}</h2>
                            <p className="text-xs text-slate-400 uppercase tracking-wider">{viewingArtifact.type.replace(/([A-Z])/g, ' $1').trim()}</p>
                        </div>
                    </div>
                    <button onClick={() => setViewingArtifact(null)} className="p-2 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 md:p-8">
                     <ArtifactRenderer artifact={viewingArtifact} />
                </div>
            </div>
        )}
    </div>
  );
};

export default StudioTab;
