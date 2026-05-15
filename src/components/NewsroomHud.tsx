import { AiConfidenceChip } from "./hud/AiConfidenceChip";
import { BreakingBar } from "./hud/BreakingBar";
import { PullQuoteCard } from "./hud/PullQuoteCard";
import { Ticker } from "./hud/Ticker";

interface NewsroomHudProps {
  confidenceAverage?: number | null;
  confidenceSampleCount?: number;
}

/**
 * Top-level broadcast HUD overlay. Mounted in [src/App.tsx] at the root of the
 * shell, above everything. Always-on layer (Ticker via Hyperframes Player) +
 * event-driven layer (BREAKING bar, fullscreen pull-quote) listening on
 * [src/lib/hudBus.ts](src/lib/hudBus.ts).
 *
 * Per-anchor pieces (OTS source card, L3 name plate) are mounted inside
 * each [AnchorCard](src/components/AnchorCard.tsx) so they pin to that anchor.
 */
export function NewsroomHud({ confidenceAverage = null, confidenceSampleCount = 0 }: NewsroomHudProps = {}) {
  return (
    <div className="newsroom-hud" aria-hidden="true">
      <BreakingBar />
      <AiConfidenceChip confidence={confidenceAverage} sampleCount={confidenceSampleCount} />
      <Ticker />
      <PullQuoteCard />
    </div>
  );
}
