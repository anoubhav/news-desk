import type { AppConfig } from "../../config";
import {
  liveResponseJsonSchema,
  parseLiveResponseText,
  readErrorMessage,
  type LiveResponseProvider,
  type LiveResponseRequest,
  type LiveResponseResult,
} from "./provider";

interface OpenAITextContent {
  type?: string;
  text?: string;
}

interface OpenAIOutputItem {
  content?: OpenAITextContent[];
}

interface OpenAIResponsePayload {
  output_text?: string;
  output?: OpenAIOutputItem[];
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function extractOpenAIText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const chunks =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .filter((text) => text.trim().length > 0) ?? [];

  if (chunks.length === 0) {
    throw new Error("OpenAI returned an empty live response turn.");
  }

  return chunks.join("\n");
}

export class OpenAIProvider implements LiveResponseProvider {
  readonly name = "openai" as const;
  readonly available: boolean;

  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig["llm"]) {
    this.available = Boolean(this.config.openaiApiKey);
    this.baseUrl = trimTrailingSlash(this.config.openaiBaseUrl);
  }

  async generateTurn(request: LiveResponseRequest): Promise<LiveResponseResult> {
    if (!this.config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const body: Record<string, unknown> = {
      model: request.override?.model ?? this.config.openaiModel,
      input: [
        {
          role: "system",
          content: request.systemPrompt,
        },
        {
          role: "user",
          content: request.userPrompt,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "live_feed_turn",
          schema: liveResponseJsonSchema,
          strict: true,
        },
      },
    };

    if (request.override?.reasoningEffort) {
      body.reasoning = { effort: request.override.reasoningEffort };
    }

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await readErrorMessage(response, `OpenAI live response request failed with ${response.status}.`);
      console.warn(`[openaiProvider] ${message}`);
      throw new Error(message);
    }

    const payload = (await response.json()) as OpenAIResponsePayload;
    try {
      const rawText = extractOpenAIText(payload);
      return parseLiveResponseText(rawText, "OpenAI");
    } catch (error) {
      console.warn("[openaiProvider] failed to parse OpenAI live response payload", error);
      throw error;
    }
  }
}
