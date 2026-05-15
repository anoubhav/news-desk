import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AnchorId, AnchorProfile, AnchorRuntimeStatus, AnchorSession, ClaimVerdict } from "@shared/models";
import { L3Name } from "./hud/L3Name";
import { OtsCard } from "./hud/OtsCard";
import { attachChromaKey } from "../lib/chromakey";
import { shouldRenderFactCheck, type FactCheckCardState } from "./FactCheckCard";

interface AnchorCardProps {
  profile: AnchorProfile;
  runtimeStatus?: AnchorRuntimeStatus;
  session: AnchorSession;
  anchors?: AnchorProfile[];
  active: boolean;
  isMulti?: boolean;
  isDebateActive?: boolean;
  activeTurnContext?: {
    replyToAnchorId?: AnchorId;
    roundIndex: number;
    isModeratorBeat?: boolean;
  } | null;
  voiceReady?: boolean;
  listening?: boolean;
  mediaRef: (element: HTMLVideoElement | null) => void;
  /** When true, route the avatar feed through a WebGL chroma-key shader and
   *  composite over a backdrop. Default off — only meaningful for green-screen
   *  avatars (selectable via [AvatarGalleryModal](./AvatarGalleryModal.tsx)). */
  chromaKey?: boolean;
  /** Latest fact-check for this anchor's most recent turn. When active, the
   *  card is promoted onto the video shell as a broadcast overlay. */
  factCheck?: FactCheckCardState;
}

const VERDICT_LABEL: Record<ClaimVerdict, string> = {
  verified: "Verified",
  disputed: "Disputed",
  unverified: "Unverified",
  opinion: "Opinion",
};

function AnchorFactCheckOverlay({ state }: { state: FactCheckCardState }) {
  // Hidden: the per-tile broadcast overlay covered the speaker's face
  // even after repositioning. Fact-check still surfaces in the side panel.
  return null;
  // eslint-disable-next-line no-unreachable
  if (state.status === "loading") {
    return (
      <motion.aside
        key="loading"
        className="anchor-factcheck-overlay anchor-factcheck-overlay-loading"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="anchor-factcheck-header">
          <span className="anchor-factcheck-eyebrow">Live fact-check</span>
          <span className="anchor-factcheck-loading">Verifying…</span>
        </div>
      </motion.aside>
    );
  }
  if (state.status !== "ready") return null;
  const { result } = state;
  if (result.mode === "unavailable") return null;
  if (result.claims.length === 0) return null;
  const claim = result.claims[0];
  const outlets = claim.sources.slice(0, 2);
  return (
    <motion.aside
      key={result.turnId}
      className={`anchor-factcheck-overlay anchor-factcheck-${claim.verdict}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="anchor-factcheck-header">
        <span className="anchor-factcheck-eyebrow">Live fact-check</span>
        <span className={`anchor-factcheck-verdict anchor-factcheck-verdict-${claim.verdict}`}>
          {VERDICT_LABEL[claim.verdict]}
        </span>
        {result.confidence != null ? (
          <span className="anchor-factcheck-confidence">{result.confidence}%</span>
        ) : null}
      </div>
      <p className="anchor-factcheck-claim">{claim.text}</p>
      {outlets.length > 0 ? (
        <div className="anchor-factcheck-sources">
          {outlets.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="anchor-factcheck-source"
              title={source.title ?? source.url}
            >
              {source.outlet}
            </a>
          ))}
        </div>
      ) : null}
    </motion.aside>
  );
}

function findAnchorLabel(anchorId: AnchorId, anchors: AnchorProfile[] | undefined) {
  if (!anchors) return anchorId;
  return anchors.find((profile) => profile.id === anchorId)?.label ?? anchorId;
}

const LEAN_LABELS: Record<AnchorId, string> = {
  neutral: "Center",
  left: "Left",
  right: "Right",
};

export function AnchorCard({
  profile,
  runtimeStatus,
  session,
  anchors,
  active,
  isMulti = false,
  isDebateActive = false,
  activeTurnContext = null,
  voiceReady = false,
  listening = false,
  mediaRef,
  chromaKey = false,
  factCheck,
}: AnchorCardProps) {
  const standbyLabel = isDebateActive ? "On deck" : "Standby";
  const stageLabel =
    active ? "Now speaking" : listening ? "Listening" : session.status === "standby" ? standbyLabel : "On stage";
  const statusBadgeText = active ? "Speaking" : session.status === "standby" ? standbyLabel : session.status;

  const showReplyPill =
    active &&
    activeTurnContext &&
    activeTurnContext.replyToAnchorId &&
    activeTurnContext.replyToAnchorId !== profile.id &&
    !activeTurnContext.isModeratorBeat;
  const replyLabel = showReplyPill
    ? findAnchorLabel(activeTurnContext!.replyToAnchorId!, anchors)
    : null;
  const showModeratorPill = active && activeTurnContext?.isModeratorBeat;
  void voiceReady;

  const dim = isMulti && !active;

  // Chroma-key plumbing: keep a local handle on the <video> alongside the
  // parent's mediaRef so we can feed its frames into a WebGL shader, then
  // render the keyed output onto a <canvas>. When chromaKey === false the
  // canvas and backdrop are hidden; the video shows through as before.
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const handleVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoElRef.current = element;
      setVideoEl(element);
      mediaRef(element);
    },
    [mediaRef],
  );

  useEffect(() => {
    if (!chromaKey) return;
    if (!videoEl || !canvasRef.current) return;
    let handle: ReturnType<typeof attachChromaKey> | null = null;
    try {
      handle = attachChromaKey(videoEl, canvasRef.current);
    } catch (err) {
      console.warn("[chromaKey] attach failed", err);
    }
    return () => handle?.stop();
  }, [chromaKey, videoEl]);

  return (
    <motion.article
      layout
      className={`anchor-card anchor-${profile.id} ${active ? "anchor-card-active" : ""} ${chromaKey ? "anchor-card-chromakey" : ""}`}
      animate={{
        opacity: dim ? 0.55 : 1,
        scale: dim ? 0.985 : 1,
      }}
      transition={{ type: "spring", stiffness: 240, damping: 30, mass: 0.8 }}
      aria-live="polite"
    >
      <L3Name anchorId={profile.id} side="left" />
      <OtsCard anchorId={profile.id} />

      <div className="anchor-video-shell">
        {chromaKey ? <div className={`anchor-backdrop anchor-backdrop-${profile.id}`} aria-hidden="true" /> : null}
        <video ref={handleVideoRef} className="anchor-video" playsInline autoPlay />
        {chromaKey ? <canvas ref={canvasRef} className="anchor-keycanvas" aria-hidden="true" /> : null}

        <AnimatePresence>
          {active && factCheck && shouldRenderFactCheck(factCheck) ? (
            <AnchorFactCheckOverlay state={factCheck} />
          ) : null}
        </AnimatePresence>

        <div className="anchor-overlay-top">
          <span /> {/* spacer pushes the status stack to the right */}
          <div className="anchor-status-stack">
            <span className={`status-pill status-${session.status}`}>{statusBadgeText}</span>
            {listening ? <span className="status-pill status-listening">Listening</span> : null}
            {replyLabel ? (
              <span className="status-pill status-reply" aria-label={`Replying to ${replyLabel}`}>
                ↩ {replyLabel}
              </span>
            ) : null}
            {showModeratorPill ? (
              <span className="status-pill status-moderator">Moderator beat</span>
            ) : null}
          </div>
        </div>

        <div className="anchor-overlay-bottom">
          <div className="anchor-identity">
            <p className="eyebrow">{stageLabel}</p>
            <div className="anchor-identity-name-row">
              <h3>{profile.label}</h3>
              <span
                className={`anchor-lean-pill anchor-lean-${profile.leaning}`}
                aria-label={`Editorial lean: ${LEAN_LABELS[profile.leaning]}`}
              >
                <span className="anchor-lean-pill-label">Lean</span>
                <span className="anchor-lean-pill-value">{LEAN_LABELS[profile.leaning]}</span>
              </span>
            </div>
            {session.startupError ? <span className="anchor-video-error">{session.startupError}</span> : null}
            {runtimeStatus && !runtimeStatus.valid ? (
              <span className="anchor-video-error">{runtimeStatus.errors.join(" ")}</span>
            ) : null}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
