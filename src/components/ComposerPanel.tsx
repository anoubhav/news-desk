import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SourceType, StoryPacket, VoiceCaptureState } from "@shared/models";

const panelPrompts = [
  "What changed?",
  "How is the left covering this?",
  "How is the right covering this?",
  "Show me both sides.",
  "Catch me up.",
];

const articlePrompts = [
  "Tell me the story in a clear, engaging way.",
  "What evidence does the article cite?",
  "Who is named in this article?",
  "What should I watch next?",
  "Catch me up.",
];

interface ComposerPanelProps {
  sourceMode: SourceType;
  viewerPrompt: string;
  loadingLivePacket: boolean;
  canRunPrompt: boolean;
  runDisabledReason?: string;
  canInterrupt: boolean;
  voiceCaptureState: VoiceCaptureState;
  voiceDraftTranscript: string;
  voiceListeningAnchorLabel: string;
  voiceAvailable: boolean;
  voiceBlockedReason?: string | null;
  voiceError?: string | null;
  storyPacket?: StoryPacket | null;
  onPromptChange: (nextPrompt: string) => void;
  onRunPrompt: (prompt: string) => void;
  onInterruptTurn: () => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onComposerFocus?: () => void;
}

function formatVoiceState(voiceCaptureState: VoiceCaptureState) {
  switch (voiceCaptureState) {
    case "preparing": return "Preparing mic";
    case "blocked": return "Microphone blocked";
    case "listening": return "Listening";
    case "transcribing": return "Transcribing";
    case "submitting": return "Submitting";
    default: return "Voice idle";
  }
}

function getHoldToTalkLabel(voiceCaptureState: VoiceCaptureState) {
  switch (voiceCaptureState) {
    case "preparing": return "Preparing mic...";
    case "listening": return "Release to send";
    case "transcribing": return "Transcribing...";
    case "submitting": return "Submitting...";
    default: return "Hold to talk";
  }
}

export function ComposerPanel({
  sourceMode,
  viewerPrompt,
  loadingLivePacket,
  canRunPrompt,
  runDisabledReason,
  canInterrupt,
  voiceCaptureState,
  voiceDraftTranscript,
  voiceListeningAnchorLabel,
  voiceAvailable,
  voiceBlockedReason,
  voiceError,
  storyPacket,
  onPromptChange,
  onRunPrompt,
  onInterruptTurn,
  onVoiceStart,
  onVoiceStop,
  onComposerFocus,
}: ComposerPanelProps) {
  const contextualPrompts = storyPacket?.suggestedPrompts ?? [];
  const fallbackPrompts = sourceMode === "article" ? articlePrompts : panelPrompts;
  const quickPrompts = contextualPrompts.length > 0 ? contextualPrompts : fallbackPrompts;
  const runButtonLabel = sourceMode === "article" ? "Tell the story" : "Ask the desk";
  const promptDisabled = (sourceMode === "live_feed" && loadingLivePacket) || voiceCaptureState !== "idle";
  const holdToTalkDisabled = !voiceAvailable || voiceCaptureState === "submitting";
  const isListening = voiceCaptureState === "listening" || voiceCaptureState === "preparing";
  const showVoiceButton = sourceMode !== "demo_story";

  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (viewerPrompt.trim().length > 0) setExpanded(true);
  }, [viewerPrompt]);

  useEffect(() => {
    if (voiceCaptureState !== "idle") setExpanded(true);
  }, [voiceCaptureState]);

  const placeholder = sourceMode === "article" ? "Ask a follow-up about the article…" : "Ask the desk what changed…";

  const voiceLine =
    voiceDraftTranscript ||
    (voiceAvailable
      ? `Hold the mic or press Z to talk to ${voiceListeningAnchorLabel}.`
      : voiceBlockedReason || "Voice unavailable in this mode.");

  return (
    <motion.section
      className="composer-dock"
      layout
      transition={{ type: "spring", stiffness: 240, damping: 30 }}
    >
      <div className="composer-dock-row">
        <div className={`composer-input-shell ${expanded ? "composer-input-shell-expanded" : "composer-input-shell-collapsed"}`}>
          <textarea
            ref={textareaRef}
            id="viewerPrompt"
            value={viewerPrompt}
            rows={expanded ? 3 : 1}
            onFocus={() => {
              setExpanded(true);
              onComposerFocus?.();
            }}
            onBlur={() => {
              if (viewerPrompt.trim().length === 0 && voiceCaptureState === "idle") setExpanded(false);
            }}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && canRunPrompt && !promptDisabled) {
                event.preventDefault();
                onRunPrompt(viewerPrompt);
              }
            }}
            placeholder={placeholder}
            aria-label={sourceMode === "article" ? "Story prompt or follow-up" : "Prompt"}
          />
        </div>

        <div className="composer-dock-actions">
          {canInterrupt ? (
            <motion.button
              type="button"
              className="composer-button composer-button-interrupt"
              onClick={onInterruptTurn}
              whileTap={{ scale: 0.96 }}
              title="Interrupt the current turn"
            >
              Interrupt turn
            </motion.button>
          ) : null}

          {showVoiceButton ? (
            <motion.button
              type="button"
              className={`composer-button ${isListening ? "composer-button-mic-active" : ""}`}
              onPointerDown={onVoiceStart}
              onPointerUp={onVoiceStop}
              onPointerCancel={onVoiceStop}
              onPointerLeave={onVoiceStop}
              disabled={holdToTalkDisabled}
              aria-pressed={isListening}
              whileTap={{ scale: 0.94 }}
            >
              {getHoldToTalkLabel(voiceCaptureState)}
            </motion.button>
          ) : null}

          <motion.button
            type="button"
            className="composer-button composer-button-primary"
            onClick={() => onRunPrompt(viewerPrompt)}
            disabled={!canRunPrompt || promptDisabled}
            whileTap={{ scale: 0.97 }}
          >
            {runButtonLabel}
          </motion.button>
        </div>
      </div>

      <div className="composer-quick-row">
        {quickPrompts.map((prompt) => (
          <motion.button
            key={prompt}
            type="button"
            className="composer-quick-prompt"
            onClick={() => onRunPrompt(prompt)}
            disabled={!canRunPrompt || promptDisabled}
            whileTap={{ scale: 0.96 }}
            title={prompt}
          >
            {prompt}
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {showVoiceButton && (expanded || voiceCaptureState !== "idle") ? (
          <motion.div
            key="voice-status"
            className="composer-voice-status"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <span className={`composer-voice-status-pill voice-status-${voiceCaptureState}`}>
              {formatVoiceState(voiceCaptureState)}
            </span>
            <span>{voiceLine}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {runDisabledReason ? <p className="composer-inline-note">{runDisabledReason}</p> : null}
      {voiceError ? <p className="composer-error">{voiceError}</p> : null}
    </motion.section>
  );
}
