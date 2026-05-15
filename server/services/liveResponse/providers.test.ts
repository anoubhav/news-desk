import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./geminiProvider";
import { OpenAIProvider } from "./openaiProvider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const baseOpenAIConfig = {
  provider: "openai" as const,
  openaiApiKey: "test-key",
  openaiModel: "gpt-4o-mini",
  openaiAdvancedModel: "gpt-5.5",
  defaultReasoningEffort: "medium" as const,
  openaiBaseUrl: "https://api.openai.com/v1",
  geminiApiKey: undefined,
  geminiModel: "gemini-2.5-flash",
};

describe("OpenAIProvider", () => {
  it("parses structured live turn output from the Responses API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  transcript: "Neutral generated line.",
                  citedEvidenceIndexes: [0, 2],
                }),
              },
            ],
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock;

    const provider = new OpenAIProvider(baseOpenAIConfig);

    const result = await provider.generateTurn({
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(result).toEqual({
      transcript: "Neutral generated line.",
      citedEvidenceIndexes: [0, 2],
    });

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.reasoning).toBeUndefined();
  });

  it("accepts yield: null from the strict schema and normalizes it to undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  transcript: "Neutral generated line.",
                  citedEvidenceIndexes: [0],
                  yield: null,
                }),
              },
            ],
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock;

    const provider = new OpenAIProvider(baseOpenAIConfig);
    const result = await provider.generateTurn({ systemPrompt: "system", userPrompt: "user" });

    expect(result.transcript).toBe("Neutral generated line.");
    expect(result.yield).toBeUndefined();

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string) as { text: { format: { schema: { required: string[] } } } };
    // The schema sent to OpenAI must list yield as required for strict mode to accept it.
    expect(body.text.format.schema.required).toContain("yield");
  });

  it("preserves a populated yield object from the LLM response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  transcript: "Handing it off.",
                  citedEvidenceIndexes: [],
                  yield: { reason: "Not enough article support to take a position." },
                }),
              },
            ],
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock;

    const provider = new OpenAIProvider(baseOpenAIConfig);
    const result = await provider.generateTurn({ systemPrompt: "system", userPrompt: "user" });

    expect(result.yield).toEqual({ reason: "Not enough article support to take a position." });
  });

  it("sends reasoning.effort and the override model when override is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  transcript: "Smart generated line.",
                  citedEvidenceIndexes: [],
                }),
              },
            ],
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock;

    const provider = new OpenAIProvider(baseOpenAIConfig);

    await provider.generateTurn({
      systemPrompt: "system",
      userPrompt: "user",
      override: { model: "gpt-5.5", reasoningEffort: "high" },
    });

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "high" });
  });
});

describe("GeminiProvider", () => {
  it("parses structured live turn output from Gemini and sends the api key via x-goog-api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    transcript: "Left framing generated line.",
                    citedEvidenceIndexes: [1],
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock;

    const provider = new GeminiProvider({
      provider: "gemini",
      openaiApiKey: undefined,
      openaiModel: "gpt-4o-mini",
      openaiAdvancedModel: "gpt-5.5",
      defaultReasoningEffort: "medium",
      openaiBaseUrl: "https://api.openai.com/v1",
      geminiApiKey: "test-key",
      geminiModel: "gemini-2.5-flash",
    });

    const result = await provider.generateTurn({
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(result).toEqual({
      transcript: "Left framing generated line.",
      citedEvidenceIndexes: [1],
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain("?key=");
    expect(calledUrl).not.toContain("&key=");
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
