import type {
  AnchorId,
  AnchorProfile,
  DebateConfig,
  SessionTranscriptEntry,
} from "../../../shared/models";
import { anchorIds } from "../../../shared/models";
import type { LiveResponseBuilder } from "../liveResponse";
import type { LiveResponseOverride } from "../liveResponse/provider";

export type BidSource = "llm" | "deterministic" | "deterministic-fallback" | "random";

export interface BidResult {
  order: AnchorId[];
  source: BidSource;
  rationale?: string;
}

function countAnchorTurns(sessionTranscript: SessionTranscriptEntry[]): number {
  return sessionTranscript.filter((entry) => entry.role === "anchor").length;
}

function clip(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}...`;
}

function buildBidSystemPrompt(args: {
  selectedAnchors: AnchorId[];
  anchorProfiles: Record<AnchorId, AnchorProfile>;
  debateConfig: DebateConfig;
}): string {
  const profileLines = args.selectedAnchors.map((anchorId) => {
    const profile = args.anchorProfiles[anchorId];
    return `- ${anchorId} (${profile.label}, ${profile.leaning}-leaning): ${profile.shortLabel}`;
  });

  const openingNote =
    args.debateConfig.openingSpeaker !== "auto" &&
    args.selectedAnchors.includes(args.debateConfig.openingSpeaker as AnchorId)
      ? `Constraint: opening speaker is fixed to "${args.debateConfig.openingSpeaker}" — put them first.`
      : `Constraint: opening speaker is "auto" — choose freely.`;

  return [
    "You are a debate director picking the order anchors should speak in for the next round of a live news desk.",
    "Goal: maximize debate value. Favor anchors most directly challenged or named in the last 2 turns; rotate in anchors who have been quiet longest; never start with an anchor who just finished speaking.",
    "Anchors available this round:",
    ...profileLines,
    openingNote,
    'Return JSON only, with shape: {"transcript": "<json-encoded array of anchor ids>", "citedEvidenceIndexes": []}.',
    'The transcript field must be a JSON string like "[\\"left\\",\\"right\\",\\"neutral\\"]" containing exactly the selected anchor ids, in your chosen order, each appearing exactly once.',
    "Do not invent new anchor ids. Do not include any other fields.",
  ].join("\n");
}

function buildBidUserPrompt(args: {
  viewerPrompt: string;
  sessionTranscript: SessionTranscriptEntry[];
  selectedAnchors: AnchorId[];
}): string {
  const transcriptLines = args.sessionTranscript.map((entry) => {
    if (entry.role === "host") {
      return `HOST: ${clip(entry.text, 400)}`;
    }
    const label = entry.anchorLabel ?? entry.anchorId ?? "anchor";
    return `${(entry.anchorId ?? "").toUpperCase()} (${label}): ${clip(entry.text, 400)}`;
  });

  return JSON.stringify(
    {
      selectedAnchors: args.selectedAnchors,
      currentViewerPrompt: args.viewerPrompt,
      sessionSoFar: transcriptLines,
    },
    null,
    2,
  );
}

function isValidPermutation(candidate: unknown, expected: AnchorId[]): candidate is AnchorId[] {
  if (!Array.isArray(candidate)) return false;
  if (candidate.length !== expected.length) return false;
  const seen = new Set<string>();
  for (const id of candidate) {
    if (typeof id !== "string") return false;
    if (!(anchorIds as readonly string[]).includes(id)) return false;
    if (!expected.includes(id as AnchorId)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export async function bidSpeakingOrder(args: {
  selectedAnchors: AnchorId[];
  deterministicOrder: AnchorId[];
  anchorProfiles: Record<AnchorId, AnchorProfile>;
  viewerPrompt: string;
  sessionTranscript?: SessionTranscriptEntry[];
  debateConfig: DebateConfig;
  liveResponseBuilder?: LiveResponseBuilder;
  override?: LiveResponseOverride;
}): Promise<BidResult> {
  const sessionTranscript = args.sessionTranscript ?? [];

  if (args.selectedAnchors.length <= 1 || countAnchorTurns(sessionTranscript) < 2) {
    return { order: args.deterministicOrder, source: "deterministic" };
  }

  const provider = args.liveResponseBuilder?.getProvider() ?? null;
  if (!provider || !provider.available) {
    return { order: args.deterministicOrder, source: "deterministic" };
  }

  try {
    const result = await provider.generateTurn({
      systemPrompt: buildBidSystemPrompt({
        selectedAnchors: args.selectedAnchors,
        anchorProfiles: args.anchorProfiles,
        debateConfig: args.debateConfig,
      }),
      userPrompt: buildBidUserPrompt({
        viewerPrompt: args.viewerPrompt,
        sessionTranscript,
        selectedAnchors: args.selectedAnchors,
      }),
      override: args.override,
    });
    const parsed = JSON.parse(result.transcript) as unknown;
    if (!isValidPermutation(parsed, args.selectedAnchors)) {
      console.warn(
        `[orchestrate:bid] invalid permutation from LLM, falling back to deterministic order. raw=${result.transcript}`,
      );
      return { order: args.deterministicOrder, source: "deterministic-fallback" };
    }
    return { order: parsed, source: "llm" };
  } catch (error) {
    console.warn("[orchestrate:bid] bidder failed, falling back to deterministic order", error);
    return { order: args.deterministicOrder, source: "deterministic-fallback" };
  }
}
