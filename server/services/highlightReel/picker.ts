import type { AnchorId, AnchorProfile, PanelTurn, StoryPacket } from "../../../shared/models";

const ANCHOR_ACCENT_FALLBACK: Record<AnchorId, string> = {
  neutral: "#E0B660",
  left: "#E07262",
  right: "#5A8FE6",
};

export interface PickedTurn {
  turn: PanelTurn;
  score: number;
  pullQuote: string;
  outlet?: string;
  citationHeadline?: string;
  accent: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is",
  "are", "as", "at", "by", "that", "this", "it", "its", "be", "been", "from",
  "than", "then", "they", "their", "we", "our", "you", "your", "i", "me", "my",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w)),
  );
}

function divergenceTokenSet(story: StoryPacket | null | undefined): Set<string> {
  if (!story) return new Set();
  return tokens(story.divergence_points.join(" "));
}

function firstSentence(text: string, maxLen = 200): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^[^.?!]{20,}?[.?!]/);
  if (match) return match[0].slice(0, maxLen).trim();
  return trimmed.slice(0, maxLen).trim();
}

function resolveAccent(profile: AnchorProfile | undefined, anchorId: AnchorId): string {
  const raw = profile?.accent;
  if (!raw || raw.startsWith("var(")) return ANCHOR_ACCENT_FALLBACK[anchorId];
  return raw;
}

/**
 * Score each turn by:
 *   (citationBoost) × (divergenceKeywordHits + 1) × (lengthFactor)
 *
 *   citationBoost   = 1 + ln(1 + citedEvidence.length)
 *   divergenceHits  = #tokens shared between the turn's transcript and the
 *                     story's divergence_points
 *   lengthFactor    = clamp(transcript.length / 200, 0.4, 1.5)
 *
 * Then pick up to `limit` turns, ordered by roundIndex then anchorId, so the
 * reel reads in narrative order rather than rank order.
 */
export function pickHighlights(
  turns: PanelTurn[],
  story: StoryPacket | null,
  anchorProfiles: AnchorProfile[],
  limit = 6,
): PickedTurn[] {
  if (!turns.length) return [];
  const divergenceTokens = divergenceTokenSet(story);
  const profileById = new Map(anchorProfiles.map((p) => [p.id, p]));

  const scored: PickedTurn[] = turns
    .filter((t) => t.transcript && t.transcript.trim().length > 0 && !t.isModeratorBeat)
    .map((turn) => {
      const turnTokens = tokens(turn.transcript);
      let hits = 0;
      for (const t of turnTokens) {
        if (divergenceTokens.has(t)) hits += 1;
      }
      const citationBoost = 1 + Math.log1p(turn.citedEvidence.length);
      const lengthFactor = Math.min(1.5, Math.max(0.4, turn.transcript.length / 200));
      const score = citationBoost * (hits + 1) * lengthFactor;
      const top = turn.citedEvidence[0];
      return {
        turn,
        score,
        pullQuote: firstSentence(turn.transcript),
        outlet: top?.channel,
        citationHeadline: top?.note,
        accent: resolveAccent(profileById.get(turn.anchorId), turn.anchorId),
      };
    });

  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  // Restore narrative order.
  top.sort((a, b) => {
    if (a.turn.roundIndex !== b.turn.roundIndex) return a.turn.roundIndex - b.turn.roundIndex;
    const anchorOrder: Record<AnchorId, number> = { neutral: 0, left: 1, right: 2 };
    return anchorOrder[a.turn.anchorId] - anchorOrder[b.turn.anchorId];
  });
  return top;
}
