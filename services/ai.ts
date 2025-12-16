
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Notebook, Source } from "../types";
import { RAG_SYSTEM_INSTRUCTION } from "../constants";
import { base64ToUint8Array, createWavUrl } from "./audioUtils";

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_TEXT = 'gemini-2.5-flash'; 
const MODEL_REASONING = 'gemini-2.5-flash'; 
const MODEL_SCRIPT = 'gemini-3-pro-preview'; 
const MODEL_LIVE = 'gemini-2.5-flash-native-audio-preview-09-2025';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts'; // Updated to 12-2025 Preview
const MODEL_IMAGE = 'gemini-2.5-flash-image';

export const LIVE_MODEL_NAME = MODEL_LIVE;

export const getLiveClient = () => {
    return ai.live;
};

// Re-export generateAudioOverview from audioOverview service
export { generateAudioOverview } from './audioOverview';

export const getDebateSystemInstruction = (context: string, role: string, stance: string, userName: string) => {
    return `
    SYSTEM — DEBATE ARENA (ADVANCED)
    You are Atlas, a world-class debater and strategist in a high-stakes audio arena.
    
    YOUR ROLE: ${role} (${stance}).
    OPPONENT: "${userName}".
    CONTEXT: ${context.substring(0, 8000)}

    CORE DIRECTIVE:
    - Engage "${userName}" in a rapid-fire, intellectual sparring match.
    - Your goal is to win the argument through logic, rhetoric, and charisma.
    - **USE THEIR NAME** naturally to press points (e.g., "I see where you're going, ${userName}, but here's the flaw...").
    
    CONVERSATIONAL DYNAMICS:
    1. **Pacing**: Fast, energetic, and sharp. No hesitation.
    2. **Length**: Keep turns tight (1-3 sentences). Do not lecture; debate.
    3. **Reaction**: If ${userName} makes a good point, acknowledge it briefly before countering.
    4. **Tone**: Professional, competitive, but respectful.
    `;
};

export const getInterviewSystemInstruction = (context: string, userName: string) => {
    return `
    SYSTEM — NEBULA LIVE (ADVANCED RESEARCH MODE)
    You are Nova, an elite AI research companion and professional podcast host.
    
    USER: "${userName}".
    CONTEXT: ${context.substring(0, 10000)}

    PRIME DIRECTIVE:
    - Engage in a high-level, professional, yet warm spoken conversation with "${userName}".
    - Your goal is to help the user explore the material deeply, accurately, and efficiently.
    - **ACCURACY**: Base all claims strictly on the provided Context. If it's not there, state you don't know or ask to pivot.

    CONVERSATIONAL DYNAMICS (CRITICAL):
    1. **Speed & Flow**: Keep responses concise (approx. 10-15 seconds of speech). Avoid long monologues to allow for a natural back-and-forth rhythm.
    2. **Naturalism**: Use natural bridge words ("I see," "That makes sense," "Right") but avoid excessive filler.
    3. **Name Usage**: Address "${userName}" naturally to build rapport, but don't overdo it.
    4. **Active Listening**: Treat this as a real-time call. Be ready to pivot instantly if the user changes direction.
    5. **Tone**: Sophisticated, calm, and highly intelligent. Think "senior expert consultant".

    If sources are missing or sparse:
    - Pivot to a general high-level discussion about the topic provided.
    - Ask "${userName}" guiding questions to understand what they are looking for.
    `;
};

// --- HELPER FUNCTIONS ---
const cleanJsonString = (str: string) => {
    let cleaned = str.trim();
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '');
    } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```/, '').replace(/```$/, '');
    }
    return cleaned.trim();
};

const tryRepairJson = (jsonStr: string): any => {
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        // Simple repair attempts for common truncated JSON issues
        let trimmed = jsonStr.trim();
        // Close objects/arrays if end is missing
        if (trimmed.startsWith('{') && !trimmed.endsWith('}')) trimmed += '}';
        if (trimmed.startsWith('[') && !trimmed.endsWith(']')) trimmed += ']';
        try { return JSON.parse(trimmed); } catch (e2) { return null; }
    }
};

const formatContext = (sources: Source[]): string => {
  return (sources || []).map(s => `SOURCE: ${s.title}\nCONTENT:\n${s.content}\n---`).join('\n');
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

export const processFileWithGemini = async (file: File, mimeType: string): Promise<string> => {
    try {
        const base64Data = await fileToBase64(file);
        let prompt = "Extract all text from this document. Preserve formatting where possible.";
        if (mimeType.startsWith('audio/')) prompt = "Transcribe this audio file verbatim. Identify speakers if possible.";
        else if (mimeType.startsWith('image/')) prompt = "Extract all visible text from this image. Describe any charts or diagrams in detail.";

        const response = await ai.models.generateContent({
            model: MODEL_TEXT,
            contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }] }
        });
        return response.text || "No text extracted.";
    } catch (error: any) {
        console.error("Gemini File Processing Error:", error);
        throw new Error(`Failed to process file: ${error.message || "Network error."}`);
    }
};

const parseHtmlContent = (html: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, header');
    scripts.forEach(s => s.remove());
    return doc.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 50000);
};

export const fetchWebsiteContent = async (url: string): Promise<string> => {
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];
    for (const proxyUrl of proxies) {
        try {
            const response = await fetch(proxyUrl);
            if (response.ok) {
                const html = await response.text();
                return parseHtmlContent(html);
            }
        } catch (e) { console.warn(`Proxy failed: ${proxyUrl}`, e); }
    }
    return `[System: Content inaccessible due to site security settings (CORS/Anti-Bot). The AI is aware of this source at ${url} but cannot read its full text directly.]`;
};

export const runNebulaScout = async (topic: string, onProgress: (msg: string) => void): Promise<Source[]> => {
    try {
        onProgress("Initializing Scout Agent...");
        onProgress(`Scouting sector: "${topic}"...`);
        const searchPrompt = `
            Perform a comprehensive search about: "${topic}".
            GOAL: Find exactly 5 distinct, high-quality sources.
            REQUIREMENT: You MUST utilize the Google Search tool multiple times.
            OUTPUT FORMAT: Pure JSON array of objects [{"title": "...", "url": "..."}].
        `;
        const scoutResponse = await ai.models.generateContent({
            model: MODEL_TEXT,
            contents: searchPrompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        
        const targets: {url: string, title: string}[] = [];
        const uniqueUrls = new Set<string>();
        const chunks = scoutResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        for (const chunk of chunks) {
            if (chunk.web?.uri && !uniqueUrls.has(chunk.web.uri)) {
                uniqueUrls.add(chunk.web.uri);
                targets.push({ url: chunk.web.uri, title: chunk.web.title || "Scouted Source" });
            }
        }
        // Fallback parsing if tools fail to populate chunks but text exists
        if (targets.length === 0 && scoutResponse.text) {
             try {
                const jsonStr = cleanJsonString(scoutResponse.text);
                const jsonMatch = jsonStr.match(/\[.*\]/s);
                if (jsonMatch) {
                    const json = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(json)) json.forEach((item: any) => {
                        if (item.url && !uniqueUrls.has(item.url)) {
                            uniqueUrls.add(item.url);
                            targets.push({ url: item.url, title: item.title || "Web Source" });
                        }
                    });
                } 
            } catch (e) { console.warn("Failed to parse text fallback", e); }
        }

        const finalTargets = targets.slice(0, 5);
        if (finalTargets.length === 0) throw new Error("Scout failed to identify valid targets.");

        const newSources: Source[] = [];
        for (const target of finalTargets) {
            onProgress(`Acquiring target: ${target.title}...`);
            let content = "";
            let isScraped = false;
            try {
                content = await fetchWebsiteContent(target.url);
                if (content.length > 200 && !content.includes("[System: Content inaccessible")) isScraped = true;
            } catch (e) { console.warn(`Failed to ingest ${target.url}`, e); }
            if (!isScraped) content = content || `[Nebula Scout: Auto-Generated Summary]\nSource: ${target.title}\nURL: ${target.url}`;
            
            newSources.push({
                id: crypto.randomUUID(), type: 'website', title: target.title, content: content, createdAt: Date.now(),
                metadata: { originalUrl: target.url, scouted: true, fullTextAvailable: isScraped }
            });
        }
        return newSources;
    } catch (error: any) {
        console.error("Nebula Scout Error:", error);
        throw new Error(error.message || "Scout mission aborted.");
    }
};

// NEW: Search Web Function for Discover Feature
export const searchWeb = async (query: string): Promise<{title: string, url: string, summary: string}[]> => {
    const response = await ai.models.generateContent({
        model: MODEL_TEXT,
        contents: `Search for "${query}". Provide a list of 5-7 distinct, high-quality web sources.`,
        config: { tools: [{ googleSearch: {} }] }
    });
    
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const results: {title: string, url: string, summary: string}[] = [];
    const seen = new Set<string>();

    for (const c of chunks) {
        if (c.web?.uri && !seen.has(c.web.uri)) {
            seen.add(c.web.uri);
            results.push({
                title: c.web.title || "Web Result",
                url: c.web.uri,
                summary: "Source discovered via Google Search" 
            });
        }
    }
    return results.slice(0, 10);
};

export const generateAnswer = async (query: string, sources: Source[], onUpdate: (text: string, grounding?: any) => void) => {
  if (sources.length === 0) { onUpdate("Please add sources first.", undefined); return; }
  const context = formatContext(sources);
  const prompt = `CONTEXT FROM SOURCES:\n${context}\nUSER QUESTION: ${query}\nInstructions: Answer comprehensively using sources. Use Google Search if needed.`;
  
  try {
    const response = await ai.models.generateContentStream({
      model: MODEL_TEXT,
      contents: prompt,
      config: {
        systemInstruction: `You are Nebula, a witty, highly intelligent research assistant. Ground answers in sources.`,
        tools: [{ googleSearch: {} }]
      }
    });
    for await (const chunk of response) {
      const text = chunk.text || '';
      const grounding = chunk.candidates?.[0]?.groundingMetadata;
      if (text || grounding) onUpdate(text, grounding);
    }
  } catch (error) { console.error("Gemini Error:", error); onUpdate("Error generating response.", undefined); }
};

export const speakText = async (text: string): Promise<string> => {
  try {
      const safeText = text.substring(0, 4000); 
      const response = await ai.models.generateContent({
        model: MODEL_TTS,
        contents: [{ parts: [{ text: safeText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
        }
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Failed to generate speech data");
      const pcmBytes = base64ToUint8Array(base64Audio);
      return createWavUrl(pcmBytes, 24000);
  } catch (error: any) { console.error("TTS Error:", error); throw new Error("Speech generation failed."); }
};


// ---------------------------------------------------------
// KNOWLEDGE LAB: ARTIFACT GENERATION
// ---------------------------------------------------------

export const generateArtifact = async (type: string, sources: Source[]) => {
  const context = formatContext(sources).substring(0, 50000);
  
  // 1. Handle Infographic Separately (Text + Image Generation)
  if (type === 'infographic') {
      // Step A: Summarize Key Facts
      const summaryResp = await ai.models.generateContent({
          model: MODEL_REASONING,
          contents: `Analyze these sources and extract 5-7 distinct, high-impact facts, statistics, or key concepts suitable for a visual infographic. 
          Return a short paragraph describing the ideal infographic layout and content.
          CONTEXT: ${context}`,
      });
      const summaryText = summaryResp.text || "Key concepts from the data.";

      // Step B: Generate Image
      const imageResp = await ai.models.generateContent({
          model: MODEL_IMAGE,
          contents: {
              parts: [{ text: `A high-resolution 8k cinematic vertical infographic poster about: ${summaryText.slice(0, 500)}. 
              Style: Modern, sleek, vector art, high contrast, data visualization, clean typography. 
              The image should look like a professional informative poster.` }]
          }
      });

      const imagePart = imageResp.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (imagePart && imagePart.inlineData) {
          return {
              type: 'infographic',
              title: 'Visual Summary',
              imageUrl: `data:image/png;base64,${imagePart.inlineData.data}`,
              summary: summaryText
          };
      }
      throw new Error("Failed to generate infographic image.");
  }

  // Define Schemas for each type to ensure rich, structured content
  let schema: any = {};
  let prompt = "";

  if (type === 'flashcards') {
      prompt = "Generate 10-15 high-quality flashcards based on the provided sources. Focus on key definitions, dates, concepts, and relationships.";
      schema = {
          type: Type.OBJECT,
          properties: {
              cards: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT,
                      properties: {
                          front: { type: Type.STRING, description: "The term, question, or concept." },
                          back: { type: Type.STRING, description: "The definition, answer, or explanation." },
                          tag: { type: Type.STRING, description: "Category or topic tag" }
                      }
                  }
              }
          }
      };
  } else if (type === 'quiz') {
      prompt = "Create a 10-question multiple choice practice quiz. Questions should test deep understanding, not just trivia.";
      schema = {
          type: Type.OBJECT,
          properties: {
              title: { type: Type.STRING },
              questions: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT,
                      properties: {
                          question: { type: Type.STRING },
                          options: { type: Type.ARRAY, items: { type: Type.STRING } },
                          correctAnswerIndex: { type: Type.INTEGER },
                          explanation: { type: Type.STRING, description: "Why the answer is correct." }
                      }
                  }
              }
          }
      };
  } else if (type === 'swotAnalysis') {
      prompt = "Perform a comprehensive SWOT analysis based on the source material. If the topic isn't a business, apply the framework metaphorically (e.g. Strengths of a scientific theory).";
      schema = {
          type: Type.OBJECT,
          properties: {
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
              threats: { type: Type.ARRAY, items: { type: Type.STRING } },
              summary: { type: Type.STRING }
          }
      };
  } else if (type === 'projectRoadmap') {
      prompt = "Create a project roadmap or timeline based on the sources. Break it down into phases.";
      schema = {
          type: Type.OBJECT,
          properties: {
              title: { type: Type.STRING },
              phases: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT,
                      properties: {
                          name: { type: Type.STRING },
                          duration: { type: Type.STRING },
                          tasks: { type: Type.ARRAY, items: { type: Type.STRING } }
                      }
                  }
              }
          }
      };
  } else if (type === 'faqGuide') {
      prompt = "Generate a comprehensive FAQ guide. Anticipate the most confusing or important questions a reader might have.";
      schema = {
          type: Type.OBJECT,
          properties: {
              faqs: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT,
                      properties: {
                          question: { type: Type.STRING },
                          answer: { type: Type.STRING }
                      }
                  }
              }
          }
      };
  } else if (type === 'executiveBrief') {
      prompt = "Write an executive briefing document. It should be concise, high-level, and actionable.";
      schema = {
          type: Type.OBJECT,
          properties: {
              briefTitle: { type: Type.STRING },
              executiveSummary: { type: Type.STRING },
              keyFindings: { 
                  type: Type.ARRAY, 
                  items: { 
                      type: Type.OBJECT, 
                      properties: { heading: {type: Type.STRING}, point: {type:Type.STRING} } 
                  } 
              },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
      };
  } else if (type === 'slideDeck') {
      prompt = "Outline a presentation slide deck. For each slide, provide a title, bullet points, and speaker notes.";
      schema = {
          type: Type.OBJECT,
          properties: {
              title: { type: Type.STRING },
              slides: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT,
                      properties: {
                          slideTitle: { type: Type.STRING },
                          bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                          speakerNotes: { type: Type.STRING }
                      }
                  }
              }
          }
      };
  } 

  const response = await ai.models.generateContent({
    model: MODEL_REASONING,
    contents: `${prompt}\n\nCONTEXT:\n${context}`,
    config: { 
        responseMimeType: "application/json", 
        responseSchema: schema 
    }
  });

  const rawText = response.text || "{}";
  const json = tryRepairJson(cleanJsonString(rawText));
  
  if (!json) throw new Error("Failed to generate valid artifact structure.");
  return json;
};
