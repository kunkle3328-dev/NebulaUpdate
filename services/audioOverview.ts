
import { GoogleGenAI, Modality } from "@google/genai";
import { Notebook, Source, AudioOverviewDialogue } from "../types";
import { base64ToUint8Array, createWavUrl } from "./audioUtils";

const MODEL_LOGIC = 'gemini-2.5-flash'; 
const MODEL_CREATIVE = 'gemini-3-pro-preview'; 
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_IMAGE = 'gemini-2.5-flash-image';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- HELPER: JSON CLEANING ---
const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '');
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '');
  return cleaned.trim();
};

const safeParseJson = async <T>(text: string, retryPrompt?: string): Promise<T> => {
  try {
    return JSON.parse(cleanJson(text));
  } catch (e) {
    if (retryPrompt) {
      console.warn("JSON parse failed, retrying with repair prompt...");
      const response = await ai.models.generateContent({
        model: MODEL_LOGIC,
        contents: `The following text was meant to be JSON but failed to parse. 
        Fix the JSON formatting ONLY. Do not add explanations.
        
        BROKEN TEXT:
        ${text.slice(0, 10000)}` 
      });
      return JSON.parse(cleanJson(response.text || "{}"));
    }
    throw new Error("Failed to parse JSON response.");
  }
};

const packSources = (sources: Source[]) => {
  return (sources || []).map(s => ({
    id: s.id,
    title: s.title,
    contentExcerpt: s.content.slice(0, 8000), 
    type: s.type
  }));
};

// --- STAGE 1: PRODUCER (BEAT SHEET) ---
const generateBlueprint = async (topic: string, sources: any[], style: string, learningStyle?: string) => {
  const hasSources = sources.length > 0;
  const sourceContext = hasSources ? JSON.stringify(sources) : "NO SPECIFIC SOURCES. Use general knowledge about the topic.";

  // Dynamic Prompt Adjustment for Learning Styles
  let styleInstruction = `STYLE: ${style}`;
  if (style === 'Study Guide' && learningStyle) {
      styleInstruction = `
      STYLE: Advanced Academic Study Guide.
      PEDAGOGY METHOD: ${learningStyle}.
      
      BEHAVIOR ADJUSTMENTS:
      - Socratic: Focus on deep questions and dialectic reasoning.
      - Feynman: Use simple analogies for complex ideas.
      - Academic: Use precise terminology, denser content, and expert synthesis.
      - Case Study: Focus on application and real-world scenarios.
      `;
  }

  const prompt = `
  SYSTEM — NEBULA PRODUCER (BEAT SHEET)

  You are a showrunner generating a live beat sheet for a dual-host audio conversation.
  ${styleInstruction}
  TOPIC: "${topic}"

  SOURCES:
  ${sourceContext}

  Return JSON only:
  {
   "segments":[
     {"title":"Hook","goal":"why user should care","beats":["...","..."],"target_seconds":30},
     {"title":"Core explanation","goal":"teach the main concept","beats":["..."],"target_seconds":180},
     {"title":"What the sources actually say","goal":"ground claims","beats":["..."],"target_seconds":120},
     {"title":"Takeaways","goal":"actionable summary","beats":["..."],"target_seconds":45}
   ],
   "facts_to_cite":[{"claim":"...","source_id":"..."}],
   "open_questions":[ "..." ],
   "tone":"smart, friendly, conversational"
  }
  
  Rules:
  - No invented facts.
  - ${hasSources ? 'Ground content in SOURCES.' : 'Use accurate general knowledge about the TOPIC.'}
  - Prefer short beats that can be spoken naturally.
  `;

  const response = await ai.models.generateContent({
    model: MODEL_LOGIC,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });

  return safeParseJson<any>(response.text || "{}", "Fix JSON blueprint");
};

// --- STAGE 2: DUAL-HOST DIALOGUE GENERATION ---
const generateDialogueScript = async (
  topic: string, 
  blueprint: any, 
  sources: any[], 
  duration: "short" | "medium" | "long",
  style: string,
  learningStyle?: string
) => {
  const estimatedTurns = duration === 'short' ? 10 : duration === 'medium' ? 20 : 35;
  const hasSources = sources.length > 0;
  const sourceContext = hasSources ? JSON.stringify(sources) : "NO SPECIFIC SOURCES. Use general knowledge.";
  const groundingRule = hasSources ? "Ground everything in provided notebook sources. If a claim is not supported by sources, say so." : "Use accurate general knowledge. Do not make up facts.";

  let personas = `
  **HOST_A (Nova)**: Explainer / Analyst. Intelligent, calm, slightly academic.
  **HOST_B (Atlas)**: Interrupter / Synthesizer. High energy, witty, pop-culture references.
  `;

  // Override Personas for Study Guide
  if (style === 'Study Guide' && learningStyle) {
      personas = `
      **HOST_A (Nova)**: The Lead Professor.
      - Tone: Authoritative, deeply knowledgeable, articulate, Socratic.
      - Role: Guides the lecture/discussion, challenges assumptions, ensures academic rigor.
      - Voice Speed: 0.75x (Deliberate).

      **HOST_B (Atlas)**: The Expert Teaching Assistant / Top Student.
      - Tone: Sharp, eager, connects theory to practice.
      - Role: Asks the "hard questions" the audience might have, provides analogies, synthesizes complex data.
      - Voice Speed: 0.9x (Energetic).
      
      PEDAGOGY: Apply the ${learningStyle} method strictly.
      `;
  }

  const prompt = `
  SYSTEM — NEBULA MIND: AUDIO OVERVIEW (DUAL-HOST)

  You are one of two co-hosts in a live, spoken conversation.
  TOPIC: ${topic}
  BEAT SHEET: ${JSON.stringify(blueprint)}
  SOURCES: ${sourceContext}

  NON-NEGOTIABLES
  1) ${groundingRule}
  2) Speak in spoken-language fragments, not essays. No long paragraphs.
  3) Allow natural disfluencies: brief fillers (“yeah”, “right”, “so”), self-corrections.
  4) Keep turn length short (1–3 sentences max per turn).
  5) Use [LAUGH], [BREATH], [SIGH] and [PAUSE] frequently to mimic real human speech patterns.

  HOST PERSONAS:
  ${personas}

  OUTPUT JSON SCHEMA:
  {
    "coldOpen": "Spoken hook line (1-2 sentences)",
    "turns": [
      { 
        "speaker": "HOST_A" | "HOST_B",
        "text": "Spoken line with timing/prosody tokens embedded.",
        "citations": [ { "sourceId": "string", "note": "optional context" } ]
      }
    ]
  }

  IMPORTANT: Generate approx ${estimatedTurns} turns.
  `;

  const response = await ai.models.generateContent({
    model: MODEL_CREATIVE, 
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });

  return safeParseJson<any>(response.text || "{}", "Fix JSON dialogue");
};

// --- STAGE 3: SYNTHESIS (AUDIO + IMAGE) ---
export const synthesizeDialogueAudio = async (
    dialogue: AudioOverviewDialogue, 
    voiceConfig?: { nova: string, atlas: string }
): Promise<{ audioUrl: string, coverUrl: string }> => {
    let ttsString = "";
    
    // Default voices if not provided
    const novaVoice = voiceConfig?.nova || 'Aoede';
    const atlasVoice = voiceConfig?.atlas || 'Orus'; 

    if (dialogue.coldOpen) {
        const cleanOpen = dialogue.coldOpen.replace(/\[.*?\]/g, '');
        ttsString += `Jane: ${cleanOpen}\n\n`;
    }

    dialogue.turns.forEach(turn => {
        const ttsSpeaker = turn.speaker === 'Nova' ? 'Jane' : 'Joe';
        
        let textForTts = turn.text
            .replace(/\[LAUGH\]/g, ' (laughs) ')
            .replace(/\[SIGH\]/g, ' (sighs) ')
            .replace(/\[BREATH\]/g, ' (takes a breath) ')
            .replace(/\[PAUSE:short\]/g, ' ... ')
            .replace(/\[PAUSE:long\]/g, ' ... ')
            .replace(/\[EMPH:(.*?)\]/g, '*$1*') 
            .replace(/\[.*?\]/g, ''); 

        const cleanText = textForTts.trim();
        if (cleanText) {
            ttsString += `${ttsSpeaker}: ${cleanText}\n`;
        }
    });

    const ttsPromise = ai.models.generateContent({
        model: MODEL_TTS,
        contents: `Generate audio for this conversation.
        
        INSTRUCTIONS:
        - Incorporate natural laughs, breaths, and hesitations.
        - Host Jane (Nova): Speak at approximately 0.75x speed (relaxed/authoritative).
        - Host Joe (Atlas): Speak at approximately 0.9x speed (energetic/eager).
        
        SCRIPT:
        ${ttsString}`,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: [
                        { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: atlasVoice } } }, 
                        { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: novaVoice } } } 
                    ]
                }
            }
        }
    });

    const imageStylePrompt = dialogue.topic.includes('Debate') ? "high contrast, intense colors, split composition" : "minimalist, elegant, gradient, vector art";
    const imagePromise = ai.models.generateContent({
        model: MODEL_IMAGE,
        contents: {
            parts: [{ text: `Album cover for a podcast about: "${dialogue.topic}". Style: ${imageStylePrompt}. High-end, 4k resolution.` }]
        }
    });

    const [audioResp, imageResp] = await Promise.all([ttsPromise, imagePromise]);

    const base64Audio = audioResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Failed to synthesize audio.");

    const pcmBytes = base64ToUint8Array(base64Audio);
    const audioUrl = createWavUrl(pcmBytes, 24000);

    let coverUrl = "";
    const imagePart = imageResp.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart && imagePart.inlineData) {
        coverUrl = `data:image/png;base64,${imagePart.inlineData.data}`;
    }

    return { audioUrl, coverUrl };
};

// --- MAIN GENERATOR FUNCTION ---
export const generateAudioOverviewDialogue = async (
  notebook: Notebook, 
  topic: string, 
  durationHint: "short" | "medium" | "long",
  style: string = "Deep Dive",
  onProgress?: (step: string) => void,
  learningStyle?: string
): Promise<AudioOverviewDialogue> => {
  
  const packedSources = packSources(notebook.sources || []);

  onProgress?.(`Producer generating ${style} beat sheet...`);
  const blueprint = await generateBlueprint(topic, packedSources, style, learningStyle);

  onProgress?.("Hosts recording conversation...");
  const scriptRaw = await generateDialogueScript(topic, blueprint, packedSources, durationHint, style, learningStyle);

  onProgress?.("Finalizing mix...");
  
  const validatedTurns = (scriptRaw.turns || []).map((turn: any) => {
    const speakerName = turn.speaker === 'HOST_A' ? 'Nova' : turn.speaker === 'HOST_B' ? 'Atlas' : turn.speaker;
    
    const validCitations = (turn.citations || []).filter((c: any) => 
      (notebook.sources || []).find(s => s.id === c.sourceId)
    );
    
    let pauseMs = 300; 
    if (turn.text.includes('[PAUSE:short]')) pauseMs = 500;
    if (turn.text.includes('[PAUSE:long]')) pauseMs = 800;

    return { 
        ...turn, 
        speaker: speakerName,
        pauseMsAfter: pauseMs,
        citations: validCitations 
    };
  });

  const dialogue: AudioOverviewDialogue = {
    id: crypto.randomUUID(),
    title: `${style}: ${topic}`,
    topic: topic,
    durationHint,
    createdAt: Date.now(),
    hosts: {
      nova: { name: "Nova", persona: "Host A" },
      atlas: { name: "Atlas", persona: "Host B" }
    },
    coldOpen: scriptRaw.coldOpen || "Let's dive in.",
    turns: validatedTurns,
    factChecks: [],
    warnings: validatedTurns.length < 5 ? ["Script generation resulted in very few turns."] : []
  };

  return dialogue;
};

export const generateAudioOverview = async (
  sources: Source[],
  duration: "short" | "medium" | "long" = "medium",
  style: string = "Deep Dive",
  voices?: { nova: string, atlas: string },
  onProgress?: (step: string) => void,
  learningIntent?: string
): Promise<AudioOverviewDialogue> => {
  const topic = sources.length > 0 ? sources[0].title : "General Overview";
  const tempNotebook: Notebook = {
      id: "temp",
      title: "Temp",
      description: "",
      sources: sources,
      artifacts: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
  };
  
  const dialogue = await generateAudioOverviewDialogue(tempNotebook, topic, duration, style, onProgress, learningIntent);
  
  if (voices) {
      (dialogue as any).voiceConfig = voices;
  }
  
  return dialogue;
};
