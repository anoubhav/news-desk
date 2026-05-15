import type { AppConfig } from "../../config";
import {
  liveResponseJsonSchema,
  parseLiveResponseText,
  readErrorMessage,
  type LiveResponseProvider,
  type LiveResponseRequest,
  type LiveResponseResult,
} from "./provider";

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

interface GeminiResponsePayload {
  candidates?: GeminiCandidate[];
}

function buildGeminiUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export class GeminiProvider implements LiveResponseProvider {
  readonly name = "gemini" as const;
  readonly available: boolean;

  constructor(private readonly config: AppConfig["llm"]) {
    this.available = Boolean(this.config.geminiApiKey);
  }

  async generateTurn(request: LiveResponseRequest): Promise<LiveResponseResult> {
    if (!this.config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured.");
    }

    const response = await fetch(buildGeminiUrl(this.config.geminiModel), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.config.geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: request.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: request.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseJsonSchema: liveResponseJsonSchema,
        },
      }),
    });

    if (!response.ok) {
      const message = await readErrorMessage(response, `Gemini live response request failed with ${response.status}.`);
      console.warn(`[geminiProvider] ${message}`);
      throw new Error(message);
    }

    const payload = (await response.json()) as GeminiResponsePayload;
    const rawText =
      payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .find((text) => text.trim().length > 0) ?? "";

    if (rawText.length === 0) {
      console.warn("[geminiProvider] Gemini returned an empty live response turn");
      throw new Error("Gemini returned an empty live response turn.");
    }

    try {
      return parseLiveResponseText(rawText, "Gemini");
    } catch (error) {
      console.warn("[geminiProvider] failed to parse Gemini live response payload", error);
      throw error;
    }
  }
}
