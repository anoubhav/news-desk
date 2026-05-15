import type { AppConfig } from "../../config";
import type { HudContext, StoryPacket } from "../../../shared/models";

export interface HudRoundContext {
  /** 0-based round index of the round being summarized. */
  roundIndex: number;
  /** Just-completed round's turns, in speaking order. */
  turns: Array<{
    anchorLabel: string;
    anchorLean?: string;
    transcript: string;
  }>;
}

type Source = "gemini" | "fallback";
type Cached = { context: HudContext; source: Source; expiresAt: number };
const cache = new Map<string, Cached>();
const TTL_MS = 30 * 60 * 1000;

function cacheKey(packet: StoryPacket, round: HudRoundContext | undefined): string {
  if (!round) return `${packet.id}:init`;
  return `${packet.id}:round-${round.roundIndex}`;
}

function fallbackContext(packet: StoryPacket): HudContext {
  const items: string[] = [];
  for (const kw of packet.keywords_spiking ?? []) {
    if (kw && items.length < 6) items.push(kw.toUpperCase());
  }
  for (const ev of packet.source_evidence ?? []) {
    if (items.length >= 8) break;
    const label = ev.note?.trim() ? `${ev.channel.toUpperCase()}: ${ev.note}` : ev.channel.toUpperCase();
    items.push(label);
  }
  if (packet.topic && items.length < 8) {
    items.unshift(packet.topic.toUpperCase());
  }
  if (items.length === 0) items.push("ELECTION DESK LIVE");
  const breakingHeadline =
    packet.divergence_points?.[0]?.toUpperCase() ??
    `${packet.topic ?? "STORY"} — PANEL SPLIT`;
  return {
    tickerItems: items.slice(0, 8),
    tickerLabel: "LIVE",
    breakingHeadline,
    breakingKicker: "BREAKING",
  };
}

const GEMINI_PROMPT_INIT = `You are a broadcast news graphics writer for a US election-desk live show.
Given the story below, return JSON with three fields:
  "tickerItems": 6 short headline fragments (4-9 words, ALL CAPS, no end punctuation, no quotes) that should crawl across the lower-third ticker. They must reference the story's topic, specific named entities, and the panel's divergence — not generic filler.
  "breakingKicker": one 1-2 word kicker in ALL CAPS (e.g. "BREAKING", "DEVELOPING", "LIVE UPDATE").
  "breakingHeadline": a single uppercased headline (8-14 words) capturing the most newsworthy tension in this story. No quotes.

Return strictly valid JSON. Do not add commentary.`;

const GEMINI_PROMPT_ROUND = `You are a broadcast news graphics writer for a US election-desk live show.
You will be given a story and a transcript of the most recent round of panel discussion (3 anchors trading takes).
Return JSON with three fields:
  "tickerItems": 6 short headline fragments (4-9 words, ALL CAPS, no end punctuation, no quotes) for the lower-third ticker. AT LEAST 3 of them must paraphrase or quote specific points the anchors just made in this round — names, framings, numbers, accusations — so a viewer scanning the chyron understands what was just argued. Do not invent facts that are not in the transcript.
  "breakingKicker": one 1-2 word kicker in ALL CAPS.
  "breakingHeadline": a single uppercased headline (8-14 words) capturing the sharpest new tension surfaced THIS round. No quotes.

Return strictly valid JSON. Do not add commentary.`;

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

async function callGemini(
  llm: AppConfig["llm"],
  packet: StoryPacket,
  round: HudRoundContext | undefined,
  signal?: AbortSignal,
): Promise<HudContext | null> {
  if (!llm.geminiApiKey) return null;
  const story = {
    topic: packet.topic,
    title: packet.title,
    keywords_spiking: packet.keywords_spiking,
    consensus_points: packet.consensus_points,
    divergence_points: packet.divergence_points,
    neutral_summary: packet.neutral_summary,
    left_framing_summary: packet.left_framing_summary,
    right_framing_summary: packet.right_framing_summary,
    sources: (packet.source_evidence ?? []).map((s) => ({
      channel: s.channel,
      lean: s.lean,
      note: s.note,
    })),
  };
  const userPayload: Record<string, unknown> = { story };
  if (round) {
    userPayload.justCompletedRound = {
      roundIndex: round.roundIndex,
      turns: round.turns.map((t) => ({
        anchor: t.anchorLabel,
        lean: t.anchorLean,
        said: t.transcript,
      })),
    };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(llm.geminiModel)}:generateContent`;
  const systemPrompt = round ? GEMINI_PROMPT_ROUND : GEMINI_PROMPT_INIT;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": llm.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(userPayload) }],
        },
      ],
      generationConfig: {
        temperature: 0.55,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          required: ["tickerItems", "breakingKicker", "breakingHeadline"],
          properties: {
            tickerItems: {
              type: "array",
              minItems: 4,
              maxItems: 8,
              items: { type: "string" },
            },
            breakingKicker: { type: "string" },
            breakingHeadline: { type: "string" },
          },
        },
      },
    }),
    signal,
  });

  if (!response.ok) {
    console.warn(`[hudContext] gemini ${response.status}`);
    return null;
  }

  const payload = (await response.json()) as GeminiPayload;
  const text =
    payload.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .find((t) => t.trim().length > 0) ?? "";
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<HudContext>;
    if (!Array.isArray(parsed.tickerItems) || parsed.tickerItems.length === 0) return null;
    if (!parsed.breakingHeadline || !parsed.breakingKicker) return null;
    return {
      tickerItems: parsed.tickerItems
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 8),
      tickerLabel: "LIVE",
      breakingHeadline: String(parsed.breakingHeadline).trim(),
      breakingKicker: String(parsed.breakingKicker).trim(),
    };
  } catch (err) {
    console.warn("[hudContext] failed to parse Gemini response", err);
    return null;
  }
}

export async function buildHudContext(
  packet: StoryPacket,
  llm: AppConfig["llm"],
  options: { force?: boolean; signal?: AbortSignal; round?: HudRoundContext } = {},
): Promise<{ context: HudContext; source: Source }> {
  const key = cacheKey(packet, options.round);
  if (!options.force) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return { context: hit.context, source: hit.source };
    }
  }

  let context: HudContext | null = null;
  try {
    context = await callGemini(llm, packet, options.round, options.signal);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") throw err;
    console.warn("[hudContext] gemini call failed", err);
  }

  const source: Source = context ? "gemini" : "fallback";
  const resolved = context ?? fallbackContext(packet);
  cache.set(key, { context: resolved, source, expiresAt: Date.now() + TTL_MS });
  return { context: resolved, source };
}

export function invalidateHudContext(storyId: string): void {
  for (const key of cache.keys()) {
    if (key === storyId || key.startsWith(`${storyId}:`)) cache.delete(key);
  }
}
