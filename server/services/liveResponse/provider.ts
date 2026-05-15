import { z } from "zod";
import type { ReasoningEffort } from "../../../shared/models";

export interface LiveResponseOverride {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface LiveResponseRequest {
  systemPrompt: string;
  userPrompt: string;
  override?: LiveResponseOverride;
}

export interface LiveResponseYield {
  reason: string;
}

export interface LiveResponseResult {
  transcript: string;
  citedEvidenceIndexes: number[];
  yield?: LiveResponseYield;
}

export interface LiveResponseProvider {
  readonly name: "openai" | "gemini";
  readonly available: boolean;
  generateTurn(request: LiveResponseRequest): Promise<LiveResponseResult>;
}

const liveResponseResultSchema = z.object({
  transcript: z.string().trim().min(1),
  citedEvidenceIndexes: z.array(z.number().int()).default([]),
  yield: z
    .object({
      reason: z.string().trim().min(1),
    })
    .nullable()
    .optional(),
});

// OpenAI structured-outputs strict mode requires every key in `properties`
// to appear in `required`. Optional fields are expressed as an anyOf with null.
export const liveResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["transcript", "citedEvidenceIndexes", "yield"],
  properties: {
    transcript: {
      type: "string",
      minLength: 1,
    },
    citedEvidenceIndexes: {
      type: "array",
      items: {
        type: "integer",
      },
    },
    yield: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: {
            reason: {
              type: "string",
              minLength: 1,
            },
          },
        },
      ],
    },
  },
} as const;

export function parseLiveResponseText(rawText: string, providerName: string): LiveResponseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`${providerName} returned invalid JSON for the live response turn.`);
  }

  const result = liveResponseResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${providerName} returned a malformed live response turn.`);
  }

  return {
    transcript: result.data.transcript.replace(/\s+/g, " ").trim(),
    citedEvidenceIndexes: result.data.citedEvidenceIndexes,
    yield: result.data.yield ?? undefined,
  };
}

export async function readErrorMessage(response: Response, fallback: string) {
  const text = await response.text().catch(() => "");
  return text.trim().length > 0 ? `${fallback} ${text.trim()}` : fallback;
}
