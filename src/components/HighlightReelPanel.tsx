import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { PanelTurn, StoryPacket } from "@shared/models";

interface ConversationGroup {
  id: string;
  turns: PanelTurn[];
}

interface Props {
  conversationGroups: ConversationGroup[];
  storyPacket: StoryPacket | null;
  highlightSessionId: string;
}

type RenderState =
  | { kind: "idle" }
  | { kind: "rendering" }
  | { kind: "ready"; mp4Url: string; durationSec: number; renderMs: number; clipsUsed: number }
  | { kind: "error"; message: string };

/**
 * Act 2: "Director's cut" highlight reel. Flattens every recorded PanelTurn
 * from the active debate, POSTs to /api/highlights/render, then embeds the
 * resulting MP4 (rendered by Hyperframes) for playback + download.
 *
 * Visible whenever the debate has ≥ 1 finished turn. The recording itself
 * happens elsewhere ([src/lib/highlightRecorder.ts] driven by App.tsx); this
 * panel just triggers the picker + composition render on demand.
 */
export function HighlightReelPanel({
  conversationGroups,
  storyPacket,
  highlightSessionId,
}: Props) {
  const [state, setState] = useState<RenderState>({ kind: "idle" });

  const turns = useMemo(
    () => conversationGroups.flatMap((g) => g.turns),
    [conversationGroups],
  );

  if (turns.length === 0) return null;

  async function handleRender() {
    setState({ kind: "rendering" });
    try {
      const response = await fetch("/api/highlights/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: highlightSessionId,
          story: storyPacket,
          turns,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "error", message: body?.message || body?.error || "Render failed" });
        return;
      }
      setState({
        kind: "ready",
        mp4Url: body.mp4Url,
        durationSec: body.durationSec ?? 0,
        renderMs: body.renderMs ?? 0,
        clipsUsed: 0, // server doesn't echo this yet
      });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <motion.section
      className="highlight-reel-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="highlight-reel-header">
        <div>
          <p className="eyebrow">Director&rsquo;s cut</p>
          <h3>Highlight reel</h3>
          <p className="highlight-reel-sub">
            {turns.length} turn{turns.length === 1 ? "" : "s"} captured — Hyperframes will render the top moments.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={handleRender}
          disabled={state.kind === "rendering"}
        >
          {state.kind === "rendering" ? "Rendering…" : state.kind === "ready" ? "Re-render" : "Generate highlights"}
        </button>
      </div>

      {state.kind === "rendering" ? (
        <p className="highlight-reel-status">Spawning `npx hyperframes render`. This takes ~10–30s for short reels.</p>
      ) : null}

      {state.kind === "error" ? (
        <p className="highlight-reel-error">Render failed: {state.message}</p>
      ) : null}

      {state.kind === "ready" ? (
        <div className="highlight-reel-result">
          <video src={state.mp4Url} controls autoPlay className="highlight-reel-video" />
          <div className="highlight-reel-meta">
            <span>Rendered in {(state.renderMs / 1000).toFixed(1)}s</span>
            <a href={state.mp4Url} download>Download MP4</a>
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}
