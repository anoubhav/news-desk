import type {
  AnchorProfile,
  HighlightManifest,
  PanelTurn,
  StoryPacket,
} from "../../../shared/models";
import { pickHighlights } from "./picker";

interface BuildArgs {
  sessionId: string;
  story: StoryPacket | null;
  turns: PanelTurn[];
  anchorProfiles: AnchorProfile[];
  /** Map from PanelTurn.turnId to URL the renderer can fetch the clip from. */
  clipUrls: Record<string, string | undefined>;
  /** Optional override for how many turns the reel should include. */
  limit?: number;
}

/**
 * Build the JSON manifest the Hyperframes highlight-reel composition consumes.
 * Pure: doesn't touch the filesystem. The caller is responsible for writing it
 * out and pointing `npx hyperframes render --variables …` at the path.
 *
 * Clips without a recorded webm URL (e.g. the user disabled recording for that
 * anchor) are dropped — the picker chose them but if there's no media to splice
 * in, we'd render a black gap.
 */
export function buildHighlightManifest(args: BuildArgs): HighlightManifest {
  const picked = pickHighlights(args.turns, args.story, args.anchorProfiles, args.limit ?? 6);
  const clips = picked
    .map((p) => {
      const url = args.clipUrls[p.turn.turnId];
      if (!url) return null;
      return {
        turnId: p.turn.turnId,
        anchorId: p.turn.anchorId,
        anchorLabel: p.turn.anchorLabel,
        clipUrl: url,
        // Duration is filled in by the renderer once it probes the webm.
        durationSeconds: 0,
        accent: p.accent,
        outlet: p.outlet,
        citationHeadline: p.citationHeadline,
        pullQuote: p.pullQuote,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return {
    sessionId: args.sessionId,
    topic: args.story?.title ?? "Election Desk Recap",
    keywords: args.story?.keywords_spiking ?? [],
    consensusPoints: args.story?.consensus_points ?? [],
    divergencePoints: args.story?.divergence_points ?? [],
    clips,
  };
}
