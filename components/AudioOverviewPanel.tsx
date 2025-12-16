
import React, { useState } from 'react';
import { Notebook, Artifact, AudioOverviewDialogue } from '../types';
import { generateAudioOverviewDialogue } from '../services/audioOverview';
import { RefreshCw, Save, Copy, CheckCircle, AlertCircle, Sparkles, Mic2, Clock, Music, Users, GraduationCap, Flame, Coffee, Newspaper, BookOpen, Mic, Loader2, BrainCircuit } from 'lucide-react';
import { useTheme } from '../contexts';
import { VOICES, PODCAST_STYLES, STUDY_STYLES } from '../constants';

interface Props {
  notebook: Notebook;
  onSaveArtifact: (artifact: Artifact) => void;
}

const AudioOverviewPanel: React.FC<Props> = ({ notebook, onSaveArtifact }) => {
  const { theme } = useTheme();
  
  // Config State
  const [topic, setTopic] = useState(notebook.title);
  const [duration, setDuration] = useState<"short" | "medium" | "long">("medium");
  const [style, setStyle] = useState('Deep Dive');
  const [studyStyle, setStudyStyle] = useState('Socratic'); // New State for Learning Styles
  const [voiceA, setVoiceA] = useState('Aoede'); 
  const [voiceB, setVoiceB] = useState('Orus'); 
  
  // Generation State
  const [status, setStatus] = useState<'idle' | 'generating' | 'completed' | 'error'>('idle');
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AudioOverviewDialogue | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setStatus('generating');
    setError('');
    setProgressStep('Initializing Nebula Producer...');

    try {
      const dialogue = await generateAudioOverviewDialogue(
        notebook, 
        topic, 
        duration, 
        style,
        (step) => setProgressStep(step),
        style === 'Study Guide' ? studyStyle : undefined // Pass Study Style if active
      );
      
      // Store voice config
      (dialogue as any).voiceConfig = { nova: voiceA, atlas: voiceB };
      
      setResult(dialogue);
      setStatus('completed');
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to generate dialogue.");
      setStatus('error');
    }
  };

  const handleSave = () => {
    if (!result) return;
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      type: 'audioOverview',
      title: result.title,
      content: result,
      createdAt: Date.now(),
      status: 'completed'
    };
    onSaveArtifact(artifact);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    alert("Script JSON copied.");
  };

  const getStyleIcon = (id: string) => {
      switch(id) {
          case 'Heated Debate': return <Flame size={18} />;
          case 'News Brief': return <Newspaper size={18} />;
          case 'Casual Chat': return <Coffee size={18} />;
          case 'Study Guide': return <GraduationCap size={18} />;
          default: return <Mic2 size={18} />;
      }
  };

  return (
    <div className="h-full flex flex-col gap-6 relative">
      
      {/* 1. Configuration Section */}
      {status === 'idle' || status === 'generating' || status === 'error' ? (
        <div className="flex flex-col items-center md:justify-center h-full w-full overflow-y-auto custom-scrollbar">
           <div className="w-full max-w-3xl space-y-6 md:space-y-8 p-4 pb-24 md:p-6 md:pb-10">
              <div className="text-center space-y-2 px-2">
                 <div className={`w-14 h-14 md:w-16 md:h-16 mx-auto rounded-2xl bg-gradient-to-br from-${theme.colors.primary}-500 to-${theme.colors.secondary}-600 flex items-center justify-center shadow-lg shadow-${theme.colors.primary}-500/20 mb-4 md:mb-6`}>
                    <Mic2 size={28} className="text-white md:w-8 md:h-8" />
                 </div>
                 <h2 className="text-2xl md:text-4xl font-bold text-white leading-tight">Audio Overview Director</h2>
                 <p className="text-slate-400 text-sm md:text-base max-w-lg mx-auto">Configure your AI podcast hosts and generation style.</p>
              </div>

              <div className="glass-panel p-4 md:p-8 rounded-3xl space-y-6 md:space-y-8 border border-white/10 relative">
                 {/* LOADING OVERLAY */}
                 {status === 'generating' && (
                     <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
                         <div className={`w-20 h-20 rounded-full border-4 border-t-transparent border-${theme.colors.primary}-500 animate-spin mb-6`}></div>
                         <h3 className="text-2xl font-bold text-white mb-2">{progressStep}</h3>
                         <p className="text-slate-400 max-w-sm mb-8">AI Agents are analyzing your sources, drafting the script, and rehearsing the dialogue.</p>
                         
                         <div className="flex items-center gap-2 text-xs text-slate-500 font-mono bg-white/5 px-4 py-2 rounded-full">
                             <Clock size={12} className={`text-${theme.colors.primary}-400`} />
                             <span>* Estimated time: 2-5 minutes</span>
                         </div>
                     </div>
                 )}

                 {/* TOPIC & DURATION */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Episode Topic</label>
                        <input 
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:outline-none focus:border-white/30 transition-all text-sm"
                          placeholder="e.g. Key takeaways from the Q3 report"
                          disabled={status === 'generating'}
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Duration</label>
                        <div className="grid grid-cols-3 gap-2">
                           {(['short', 'medium', 'long'] as const).map(d => (
                              <button
                                key={d}
                                onClick={() => setDuration(d)}
                                disabled={status === 'generating'}
                                className={`py-3 text-xs font-bold uppercase rounded-xl transition-all border ${duration === d ? `bg-${theme.colors.primary}-600 border-${theme.colors.primary}-500 text-white shadow` : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
                              >
                                {d}
                              </button>
                           ))}
                        </div>
                     </div>
                 </div>

                 {/* STYLE SELECTION */}
                 <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Music size={14} /> Podcast Style
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                        {PODCAST_STYLES.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setStyle(s.id)}
                                disabled={status === 'generating'}
                                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all h-full ${style === s.id ? `bg-${theme.colors.primary}-500/20 border-${theme.colors.primary}-500 text-white` : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                            >
                                <div className={`${style === s.id ? `text-${theme.colors.primary}-400` : 'text-slate-500'}`}>
                                    {getStyleIcon(s.id)}
                                </div>
                                <span className="text-xs font-bold text-center leading-tight">{s.label}</span>
                            </button>
                        ))}
                    </div>
                 </div>

                 {/* SUB-STYLE FOR STUDY GUIDE (NEW) */}
                 {style === 'Study Guide' && (
                     <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <BrainCircuit size={14} /> Pedagogical Method
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {STUDY_STYLES.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => setStudyStyle(s.id)}
                                    disabled={status === 'generating'}
                                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${studyStyle === s.id ? `bg-${theme.colors.secondary}-500/20 border-${theme.colors.secondary}-500 text-white` : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                                >
                                    <div className="flex-1">
                                        <div className="text-xs font-bold">{s.label}</div>
                                        <div className="text-[10px] text-slate-500 mt-1 leading-tight">{s.desc}</div>
                                    </div>
                                    {studyStyle === s.id && <CheckCircle size={16} className={`text-${theme.colors.secondary}-400`} />}
                                </button>
                            ))}
                        </div>
                     </div>
                 )}

                 {/* VOICE SELECTION */}
                 <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Users size={14} /> Host Voices
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Host A */}
                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                             <span className="text-[10px] text-indigo-400 font-bold uppercase mb-2 block">
                                {style === 'Study Guide' ? 'Professor A (Lead)' : 'Nova (Host A)'}
                             </span>
                             <div className="grid grid-cols-2 gap-2">
                                {VOICES.jane.map((v) => (
                                    <button 
                                        key={v.id}
                                        onClick={() => setVoiceA(v.id)}
                                        className={`px-2 py-2 text-xs rounded-lg border text-left transition-all ${voiceA === v.id ? 'bg-indigo-500/20 border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                    >
                                        {v.name.split(' ')[0]}
                                    </button>
                                ))}
                             </div>
                        </div>
                        {/* Host B */}
                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                             <span className="text-[10px] text-teal-400 font-bold uppercase mb-2 block">
                                {style === 'Study Guide' ? 'Professor B (Support)' : 'Atlas (Host B)'}
                             </span>
                             <div className="grid grid-cols-2 gap-2">
                                {VOICES.joe.map((v) => (
                                    <button 
                                        key={v.id}
                                        onClick={() => setVoiceB(v.id)}
                                        className={`px-2 py-2 text-xs rounded-lg border text-left transition-all ${voiceB === v.id ? 'bg-teal-500/20 border-teal-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                    >
                                        {v.name.split(' ')[0]}
                                    </button>
                                ))}
                             </div>
                        </div>
                    </div>
                 </div>

                 {status === 'error' && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg flex items-center gap-2">
                       <AlertCircle size={16} />
                       {error}
                    </div>
                 )}

                 <button
                    onClick={handleGenerate}
                    disabled={status === 'generating' || !topic.trim()}
                    className={`w-full py-4 bg-gradient-to-r from-${theme.colors.primary}-600 to-${theme.colors.secondary}-600 text-white rounded-xl font-bold shadow-lg transform hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
                 >
                    {status === 'generating' ? (
                       <>
                         <RefreshCw className="animate-spin" size={20} />
                         <span>Generating...</span>
                       </>
                    ) : (
                       <>
                         <Sparkles size={20} />
                         <span>Generate Script</span>
                       </>
                    )}
                 </button>
              </div>
           </div>
        </div>
      ) : (
        /* 2. Results Section */
        <div className="flex flex-col h-full overflow-hidden animate-in slide-in-from-bottom-4">
           {/* Header */}
           <div className="flex flex-col md:flex-row md:items-center justify-between p-4 pb-4 border-b border-white/5 shrink-0 gap-4 bg-black/20 backdrop-blur-md">
              <div className="min-w-0 flex-1">
                 <h2 className="text-lg md:text-2xl font-bold text-white leading-tight break-words">{result?.title}</h2>
                 <p className="text-xs md:text-sm text-slate-400 flex items-center gap-2 mt-1">
                    <span className={`w-2 h-2 rounded-full bg-green-500`}></span>
                    Script Generated • {result?.turns.length} Turns
                 </p>
              </div>
              <div className="flex gap-2 shrink-0 self-start md:self-center">
                 <button onClick={handleCopy} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors" title="Copy JSON">
                    <Copy size={18} />
                 </button>
                 <button onClick={handleSave} className={`px-4 py-2 bg-${theme.colors.primary}-600 hover:bg-${theme.colors.primary}-500 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-lg`}>
                    <Save size={16} /> Save to Notebook
                 </button>
                 <button onClick={() => setStatus('idle')} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-bold transition-colors">
                    New
                 </button>
              </div>
           </div>

           {/* Script Viewer */}
           <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 custom-scrollbar pb-24 md:pb-8">
              {/* Cold Open */}
              <div className="glass-panel p-6 rounded-xl border-l-4 border-purple-500 bg-purple-900/10">
                 <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2 block">Cold Open</span>
                 <p className="text-slate-200 italic font-medium leading-relaxed">"{result?.coldOpen}"</p>
              </div>

              {/* Turns */}
              <div className="space-y-6">
                 {result?.turns.map((turn, idx) => (
                    <div key={idx} className={`flex gap-3 md:gap-5 ${turn.speaker === 'Atlas' ? 'flex-row-reverse' : ''}`}>
                       <div className={`w-8 h-8 md:w-12 md:h-12 rounded-full flex items-center justify-center shrink-0 border-2 shadow-lg text-sm md:text-base ${turn.speaker === 'Nova' ? 'bg-indigo-600 border-indigo-400' : 'bg-teal-600 border-teal-400'}`}>
                          <span className="text-white font-bold">{turn.speaker[0]}</span>
                       </div>
                       
                       <div className={`flex flex-col max-w-[85%] md:max-w-[75%] ${turn.speaker === 'Atlas' ? 'items-end' : 'items-start'}`}>
                          <div className={`p-4 rounded-2xl md:rounded-3xl border shadow-sm ${turn.speaker === 'Atlas' ? 'bg-teal-900/20 border-teal-500/20 rounded-tr-sm text-right' : 'bg-indigo-900/20 border-indigo-500/20 rounded-tl-sm text-left'}`}>
                             <p className="text-slate-200 leading-relaxed text-sm md:text-base whitespace-pre-wrap break-words">{turn.text}</p>
                          </div>
                          
                          {/* Metadata line */}
                          <div className={`flex flex-wrap items-center gap-2 mt-2 text-[10px] md:text-xs text-slate-500 ${turn.speaker === 'Atlas' ? 'justify-end' : 'justify-start'}`}>
                             <span className="flex items-center gap-1"><Clock size={10} /> {turn.pauseMsAfter}ms</span>
                             {turn.citations.length > 0 && (
                                <div className="flex flex-wrap gap-1 justify-end">
                                   {turn.citations.map((c, i) => (
                                      <span key={i} className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 border border-slate-700 truncate max-w-[100px]">
                                         Src: {notebook.sources.find(s => s.id === c.sourceId)?.title.slice(0, 10)}
                                      </span>
                                   ))}
                                </div>
                             )}
                          </div>
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AudioOverviewPanel;
