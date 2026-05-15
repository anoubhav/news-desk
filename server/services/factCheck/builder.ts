import type { AppConfig } from "../../config";
import type {
  AnchorLean,
  ClaimVerdict,
  FactCheckRequest,
  FactCheckResult,
  FactClaim,
  FactSource,
} from "../../../shared/models";

const verdicts: readonly ClaimVerdict[] = ["verified", "disputed", "unverified", "opinion"] as const;

const knownOutletMap: Record<string, string> = {
  "reuters.com": "Reuters",
  "apnews.com": "Associated Press",
  "bbc.com": "BBC News",
  "bbc.co.uk": "BBC News",
  "nytimes.com": "The New York Times",
  "washingtonpost.com": "The Washington Post",
  "wsj.com": "The Wall Street Journal",
  "ft.com": "Financial Times",
  "theguardian.com": "The Guardian",
  "cnn.com": "CNN",
  "nbcnews.com": "NBC News",
  "abcnews.go.com": "ABC News",
  "cbsnews.com": "CBS News",
  "foxnews.com": "Fox News",
  "politico.com": "Politico",
  "axios.com": "Axios",
  "bloomberg.com": "Bloomberg",
  "economist.com": "The Economist",
  "npr.org": "NPR",
  "aljazeera.com": "Al Jazeera",
  "wikipedia.org": "Wikipedia",
};

function prettifyHost(host: string): string {
  const stripped = host.replace(/^www\./, "");
  if (knownOutletMap[stripped]) return knownOutletMap[stripped];
  const root = stripped.split(".").slice(-2)[0] ?? stripped;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export function outletFromUrl(url: string): string {
  try {
    return prettifyHost(new URL(url).host);
  } catch {
    return "Source";
  }
}

interface GeminiGroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GeminiGroundingChunk {
  web?: GeminiGroundingChunkWeb;
}

interface GeminiCandidate {
  content?: {
    parts?: { text?: string }[];
  };
  groundingMetadata?: {
    groundingChunks?: GeminiGroundingChunk[];
  };
}

interface GeminiResponsePayload {
  candidates?: GeminiCandidate[];
}

export interface RawFactCheckClaim {
  text: string;
  verdict: string;
  rationale?: string;
  sourceIndexes?: number[];
}

export interface RawFactCheckPayload {
  confidence?: number;
  claims: RawFactCheckClaim[];
}

const fenceRe = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = fenceRe.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

function normalizeVerdict(value: unknown): ClaimVerdict {
  if (typeof value !== "string") return "unverified";
  const lower = value.toLowerCase().trim();
  return (verdicts as readonly string[]).includes(lower) ? (lower as ClaimVerdict) : "unverified";
}

export function parseFactCheckText(text: string): RawFactCheckPayload {
  const block = extractJsonBlock(text);
  if (!block) throw new Error("Fact-check response missing JSON block.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    throw new Error("Fact-check response was not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Fact-check response was not an object.");
  }
  const obj = parsed as Record<string, unknown>;
  const claimsRaw = Array.isArray(obj.claims) ? obj.claims : [];
  const claims: RawFactCheckClaim[] = [];
  for (const item of claimsRaw) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const textValue = typeof c.text === "string" ? c.text.trim() : "";
    if (!textValue) continue;
    const verdict = typeof c.verdict === "string" ? c.verdict : "unverified";
    const rationale = typeof c.rationale === "string" ? c.rationale.trim() : undefined;
    const sourceIndexes = Array.isArray(c.sourceIndexes)
      ? c.sourceIndexes.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0)
      : [];
    claims.push({ text: textValue, verdict, rationale, sourceIndexes });
  }
  const confidence = typeof obj.confidence === "number" ? obj.confidence : undefined;
  return { confidence, claims: claims.slice(0, 3) };
}

export function dedupeSources(sources: FactSource[]): FactSource[] {
  const seen = new Set<string>();
  const out: FactSource[] = [];
  for (const source of sources) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
  }
  return out;
}

export function buildFactCheckSystemPrompt(): string {
  return buildSystemPrompt();
}

export function buildFactCheckUserPrompt(request: FactCheckRequest): string {
  return buildUserPrompt(request);
}

function buildSystemPrompt(): string {
  return [
    "You are a careful real-time fact-checker assisting a news desk.",
    "Given an anchor's spoken transcript, extract the 1–3 most checkable factual claims.",
    "If `articleContext` is provided, ground claims primarily against the article text (neutralSummary, lensFraming, articleExcerpt). Use Google Search only for claims the article does not cover, or to corroborate the article.",
    "Otherwise use Google Search to verify each claim against reputable sources.",
    "Rules:",
    "- If a statement is a personal opinion, prediction, or framing, mark it as `opinion`, not `unverified`.",
    "- Use `verified` only when the article text or reputable sources clearly support the claim.",
    "- Use `disputed` when the article text or reputable sources directly contradict the claim.",
    "- Use `unverified` when evidence is thin or ambiguous.",
    "- For each claim, cite the source indexes (0-based) from your search results that support your verdict.",
    "Return ONLY a JSON object inside ```json fences with this exact shape:",
    "{",
    '  "confidence": <number 0-100 — overall trustworthiness of the transcript>,',
    '  "claims": [',
    '    { "text": "<exact span from transcript>", "verdict": "verified|disputed|unverified|opinion", "rationale": "<one sentence>", "sourceIndexes": [<int>] }',
    "  ]",
    "}",
    "Do not include any prose outside the JSON fence.",
  ].join("\n");
}

function buildUserPrompt(request: FactCheckRequest): string {
  return JSON.stringify(
    {
      storyTitle: request.storyTitle,
      storyTopic: request.storyTopic,
      anchorLean: request.anchorLean satisfies AnchorLean,
      transcript: request.transcript,
      articleContext: request.articleContext,
    },
    null,
    2,
  );
}

function buildGeminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function extractGroundingSources(candidate: GeminiCandidate | undefined): FactSource[] {
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const sources: FactSource[] = [];
  for (const chunk of chunks) {
    const url = chunk.web?.uri;
    if (!url) continue;
    sources.push({
      outlet: outletFromUrl(url),
      url,
      title: chunk.web?.title,
    });
  }
  return dedupeSources(sources);
}

function pickClaimSources(claim: RawFactCheckClaim, allSources: FactSource[]): FactSource[] {
  if (claim.sourceIndexes && claim.sourceIndexes.length > 0) {
    const picked: FactSource[] = [];
    for (const idx of claim.sourceIndexes) {
      const source = allSources[idx];
      if (source) picked.push(source);
    }
    if (picked.length > 0) return dedupeSources(picked).slice(0, 4);
  }
  return allSources.slice(0, 3);
}

function clampConfidence(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 70;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export interface FactCheckProvider {
  readonly available: boolean;
  factCheck(request: FactCheckRequest): Promise<FactCheckResult>;
}

export class GeminiFactCheckProvider implements FactCheckProvider {
  readonly available: boolean;

  constructor(private readonly config: AppConfig["llm"]) {
    this.available = Boolean(this.config.geminiApiKey);
  }

  async factCheck(request: FactCheckRequest): Promise<FactCheckResult> {
    if (!this.config.geminiApiKey) {
      return {
        turnId: request.turnId,
        confidence: null,
        mode: "unavailable",
        claims: [],
        generatedAt: new Date().toISOString(),
        unavailableReason: "GEMINI_API_KEY is not configured.",
      };
    }

    const response = await fetch(buildGeminiUrl(this.config.geminiModel), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.config.geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(request) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini fact-check request failed with ${response.status}. ${text.slice(0, 200)}`);
    }

    const payload = (await response.json()) as GeminiResponsePayload;
    const candidate = payload.candidates?.[0];
    const rawText =
      candidate?.content?.parts
        ?.map((part) => part.text ?? "")
        .find((value) => value.trim().length > 0) ?? "";

    if (!rawText) {
      throw new Error("Gemini fact-check returned an empty response.");
    }

    const allSources = extractGroundingSources(candidate);
    const parsed = parseFactCheckText(rawText);

    const claims: FactClaim[] = parsed.claims.map((raw) => ({
      text: raw.text,
      verdict: normalizeVerdict(raw.verdict),
      rationale: raw.rationale ?? "",
      sources: pickClaimSources(raw, allSources),
    }));

    return {
      turnId: request.turnId,
      confidence: clampConfidence(parsed.confidence),
      mode: "grounded",
      claims,
      generatedAt: new Date().toISOString(),
    };
  }
}

export function createFactCheckProvider(config: AppConfig["llm"]): FactCheckProvider {
  return new GeminiFactCheckProvider(config);
}

export function buildUnavailableResult(turnId: string, reason: string): FactCheckResult {
  return {
    turnId,
    confidence: null,
    mode: "unavailable",
    claims: [],
    generatedAt: new Date().toISOString(),
    unavailableReason: reason,
  };
}
