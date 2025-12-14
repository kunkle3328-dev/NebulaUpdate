
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
  return sources.map(s => ({
    id: s.id,
    title: s.title,
    contentExcerpt: s.content.slice(0, 8000), 
    type: s.type
  }));
};

// --- STAGE 1: BLUEPRINT GENERATION ---
const generateBlueprint = async (topic: string, sources: any[], style: string) => {
  const prompt = `
  ROLE: Senior Content Strategist for a Podcast.
  STYLE: ${style}
  TASK: Create a blueprint for a 2-host conversation about: "${topic}".
  
  SOURCES:
  ${JSON.stringify(sources)}
  
  GOAL:
  Identify the core narrative arc, key claims that need evidence, and potential gaps.
  
  OUTPUT JSON ONLY:
  {
    "angle": "The unique angle/hook for this episode based on the style",
    "structure": ["Introduction", "Point 1: ...", "Point 2: ...", "Conclusion"],
    "keyClaims": [
      { "claim": "string", "requiresSourceId": "id from sources" }
    ],
    "controversialPoint": "A specific point relevant to the style"
  }
  `;

  const response = await ai.models.generateContent({
    model: MODEL_LOGIC,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });

  return safeParseJson<any>(response.text || "{}", "Fix JSON blueprint");
};

// --- STAGE 2: DIALOGUE GENERATION ---
const generateDialogueScript = async (
  topic: string, 
  blueprint: any, 
  sources: any[], 
  duration: "short" | "medium" | "long",
  style: string
) => {
  const wordCount = duration === 'short' ? 600 : duration === 'medium' ? 1200 : 1800;
  
  let personasInstruction = "";
  if (style === 'Heated Debate') {
      personasInstruction = `
      - Nova (Host A): The Proponent. Passionate, optimistic, defends the topic vigorously.
      - Atlas (Host B): The Skeptic. Critical, questions everything, demands hard proof.
      - DYNAMIC: Intense, fast-paced, frequent interruptions (represented by dashes), but respectful.
      `;
  } else if (style === 'News Brief') {
      personasInstruction = `
      - Nova (Host A): Lead Anchor. Formal, authoritative, clear.
      - Atlas (Host B): Field Correspondent. Fast, detail-oriented, brings the data.
      - DYNAMIC: Professional, structured, high information density. No fluff.
      `;
  } else if (style === 'Study Guide') {
      personasInstruction = `
      - Nova (Host A): The Teacher/Tutor. Patient, clear, uses analogies to explain concepts.
      - Atlas (Host B): The Student. Curious, asks clarifying questions ("So you mean...?"), summarizes points to check understanding.
      - DYNAMIC: Educational, repetitive for reinforcement, focuses on "The Big Picture".
      `;
  } else if (style === 'Casual Chat') {
      personasInstruction = `
      - Nova (Host A): Chill, observant, storyteller.
      - Atlas (Host B): High energy, makes jokes, relates things to pop culture.
      - DYNAMIC: Relaxed, lots of "Whoa", "Crazy", "Right?". Feels like a coffee shop chat.
      `;
  } else {
      // Deep Dive (Default)
      personasInstruction = `
      - Nova (Host A): Calm, grounded, slightly slower, clear explainer. The anchor.
      - Atlas (Host B): Energetic, curious, fast-paced, asks sharp questions. The explorer.
      - DYNAMIC: Intellectual discovery, "Aha!" moments.
      `;
  }

  const prompt = `
  ROLE: Senior Podcast Dialogue Writer.
  STYLE: ${style}
  TASK: Write the full dialogue script based on the Blueprint.
  
  TOPIC: ${topic}
  BLUEPRINT: ${JSON.stringify(blueprint)}
  SOURCES: ${JSON.stringify(sources)}
  TARGET LENGTH: Approx ${wordCount} words.
  
  PERSONAS & DYNAMICS:
  ${personasInstruction}
  
  STRICT RULES:
  1. SOUND REAL: Use contractions, interjections, and natural flow.
  2. NO ROBOTIC TRANSITIONS: Ban "Firstly", "In conclusion". Use natural segues.
  3. INTERACTION: Hosts must react to each other.
  4. CURIOSITY: Include moments of realization.
  5. GROUNDING: EVERY substantive claim must cite a sourceId.
  6. COLD OPEN: Start with a hook (1-2 lines).
  
  OUTPUT JSON SCHEMA:
  {
    "coldOpen": "string",
    "turns": [
      { 
        "speaker": "Nova" | "Atlas", 
        "text": "dialogue string", 
        "pauseMsAfter": number (150-900),
        "citations": [ { "sourceId": "string", "note": "optional context" } ]
      }
    ],
    "factChecks": [
      { "claim": "string", "sourceId": "string", "evidenceSnippet": "EXACT substring from source content" }
    ]
  }
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
    const atlasVoice = voiceConfig?.atlas || 'Puck';

    // 1. Prepare TTS String
    if (dialogue.coldOpen) {
        ttsString += `Jane: ${dialogue.coldOpen}\n\n`;
    }

    dialogue.turns.forEach(turn => {
        const ttsSpeaker = turn.speaker === 'Nova' ? 'Jane' : 'Joe';
        ttsString += `${ttsSpeaker}: ${turn.text}\n`;
    });

    // 2. Run TTS and Image Generation in Parallel
    const ttsPromise = ai.models.generateContent({
        model: MODEL_TTS,
        contents: `Generate audio for this dialogue:\n\n${ttsString}`,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: [
                        { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: atlasVoice } } }, // Atlas
                        { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: novaVoice } } } // Nova
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

    // 3. Process Audio
    const base64Audio = audioResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Failed to synthesize audio.");

    const pcmBytes = base64ToUint8Array(base64Audio);
    const audioUrl = createWavUrl(pcmBytes, 24000);

    // 4. Process Image
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
  onProgress?: (step: string) => void
): Promise<AudioOverviewDialogue> => {
  
  if (!notebook.sources || notebook.sources.length === 0) {
    throw new Error("No sources available in notebook.");
  }

  const packedSources = packSources(notebook.sources);

  // 1. Blueprint
  onProgress?.(`Designing ${style} blueprint...`);
  const blueprint = await generateBlueprint(topic, packedSources, style);

  // 2. Dialogue
  onProgress?.("Writing script & performing simulation...");
  const scriptRaw = await generateDialogueScript(topic, blueprint, packedSources, durationHint, style);

  // 3. Validation
  onProgress?.("Validating citations and evidence...");
  
  const validatedTurns = scriptRaw.turns.map((turn: any) => {
    const validCitations = (turn.citations || []).filter((c: any) => 
      notebook.sources.find(s => s.id === c.sourceId)
    );
    return { ...turn, citations: validCitations };
  });

  const validatedFactChecks = (scriptRaw.factChecks || []).filter((fc: any) => {
    const source = notebook.sources.find(s => s.id === fc.sourceId);
    return !!source; 
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
    factChecks: validatedFactChecks,
    warnings: validatedTurns.length < 5 ? ["Script generation resulted in very few turns."] : []
  };

  return dialogue;
};

// --- JOB COMPATIBLE GENERATOR ---
export const generateAudioOverview = async (
  sources: Source[],
  duration: "short" | "medium" | "long" = "medium",
  style: string = "Deep Dive",
  voices?: { nova: string, atlas: string },
  onProgress?: (step: string) => void,
  learningIntent?: string
): Promise<AudioOverviewDialogue> => {
  const topic = sources.length > 0 ? sources[0].title : "General Overview";
  // Create a minimal notebook object to satisfy the interface
  const tempNotebook: Notebook = {
      id: "temp",
      title: "Temp",
      description: "",
      sources: sources,
      artifacts: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
  };
  
  const dialogue = await generateAudioOverviewDialogue(tempNotebook, topic, duration, style, onProgress);
  
  if (voices) {
      (dialogue as any).voiceConfig = voices;
  }
  
  return dialogue;
};
