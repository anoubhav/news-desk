import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AnchorId, AnchorProfile, PanelTurn } from "@shared/models";
import { FactCheckCard, shouldRenderFactCheck, type FactCheckCardState } from "./FactCheckCard";

type ConversationPromptSource = "typed" | "voice";
type ConversationPromptStatus = "recording" | "transcribing" | "answering" | "done" | "failed";

interface ConversationPrompt {
  id: string;
  text: string;
  source: ConversationPromptSource;
  status: ConversationPromptStatus;
}

interface ConversationGroup {
  id: string;
  prompt: ConversationPrompt;
  turns: PanelTurn[];
}

interface PanelTurnsProps {
  conversations: ConversationGroup[];
  activeQuestionId?: string | null;
  anchors?: AnchorProfile[];
  factChecks?: Map<string, FactCheckCardState>;
}

function formatGenerationSource(source: PanelTurn["generationSource"]) {
  switch (source) {
    case "openai": return "OpenAI";
    case "gemini": return "Gemini";
    case "template_fallback": return "Template fallback";
    case "article": return "Article";
    default: return source;
  }
}

function formatPromptSource(source: ConversationPromptSource) {
  return source === "voice" ? "Voice question" : "Typed prompt";
}

function formatPromptStatus(status: ConversationPromptStatus) {
  switch (status) {
    case "recording": return "Recording";
    case "transcribing": return "Transcribing";
    case "answering": return "Answering now";
    case "failed": return "Needs retry";
    default: return null;
  }
}

function buildAnchorLabelLookup(anchors: AnchorProfile[] | undefined, fallback: PanelTurn) {
  const map = new Map<AnchorId, string>();
  if (anchors) {
    for (const profile of anchors) map.set(profile.id, profile.label);
  }
  if (!map.has(fallback.anchorId)) map.set(fallback.anchorId, fallback.anchorLabel);
  return map;
}

function getAnchorLabel(anchorId: AnchorId, turn: PanelTurn, labelLookup: Map<AnchorId, string>) {
  if (anchorId === turn.anchorId) return turn.anchorLabel;
  return labelLookup.get(anchorId) ?? anchorId;
}

export function PanelTurns({ conversations, activeQuestionId, anchors, factChecks }: PanelTurnsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const prevLatestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const latest = conversations[conversations.length - 1];
    if (!latest) {
      prevLatestIdRef.current = null;
      setExpandedId(null);
      return;
    }
    if (latest.id !== prevLatestIdRef.current) {
      setExpandedId(latest.id);
      prevLatestIdRef.current = latest.id;
    }
  }, [conversations]);

  const orderedConversations = [...conversations].reverse();

  if (conversations.length === 0) {
    return <p className="empty-state">Responses will appear here after you ask the desk a question.</p>;
  }

  return (
    <div className="turn-list">
      <AnimatePresence initial={false}>
        {orderedConversations.map((conversation, displayIndex) => {
          const originalIndex = conversations.length - 1 - displayIndex;
          const isExpanded = expandedId === conversation.id;
          const promptStatusLabel = formatPromptStatus(conversation.prompt.status);
          const toggle = () => setExpandedId(isExpanded ? null : conversation.id);

          return (
            <motion.section
              key={conversation.id}
              layout
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: "spring", stiffness: 240, damping: 30 }}
              className={`conversation-group ${isExpanded ? "conversation-group-expanded" : "conversation-group-collapsed"} ${activeQuestionId === conversation.id ? "conversation-group-active" : ""}`}
            >
              <article className="turn-card turn-user">
                <button
                  type="button"
                  className="conversation-toggle"
                  onClick={toggle}
                  aria-expanded={isExpanded}
                  aria-controls={`conversation-body-${conversation.id}`}
                  title={isExpanded ? "Collapse this question to hide the presenters' replies." : "Expand this question to see the presenters' replies."}
                >
                  <header className="turn-card-header">
                    <div>
                      <strong>You</strong>
                      <span>{formatPromptSource(conversation.prompt.source)}</span>
                    </div>
                    <div className="conversation-toggle-right">
                      <div className="turn-index">{originalIndex + 1}</div>
                      <span className={`conversation-toggle-chevron ${isExpanded ? "is-open" : ""}`} aria-hidden="true">▸</span>
                    </div>
                  </header>
                  <p className="conversation-prompt-text">{conversation.prompt.text}</p>
                </button>

                {isExpanded && promptStatusLabel ? (
                  <p className="conversation-status-note">{promptStatusLabel}</p>
                ) : null}
              </article>

              <AnimatePresence initial={false}>
                {isExpanded ? (
                  <motion.div
                    key="body"
                    id={`conversation-body-${conversation.id}`}
                    className="conversation-body"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    {[...conversation.turns].reverse().map((turn, turnIndex) => {
                      const labelLookup = buildAnchorLabelLookup(anchors, turn);
                      const speakerLabel = turn.anchorLabel;
                      const roundLabel = `Round ${turn.roundIndex + 1}`;
                      const replyLabel =
                        turn.replyToAnchorId && turn.replyToAnchorId !== turn.anchorId
                          ? getAnchorLabel(turn.replyToAnchorId, turn, labelLookup)
                          : null;

                      const headerParts: string[] = [speakerLabel, roundLabel];
                      if (turn.isModeratorBeat) headerParts.push("Moderator beat");
                      else if (replyLabel) headerParts.push(`responding to ${replyLabel}`);

                      return (
                        <motion.article
                          key={turn.turnId}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, delay: turnIndex * 0.04 }}
                          className={`turn-card turn-${turn.anchorId}${turn.yielded ? " turn-yielded" : ""}`}
                        >
                          <header className="turn-card-header">
                            <div>
                              <strong>{turn.anchorLabel}</strong>
                              <span>
                                {turn.responseGoal.replaceAll("_", " ")} • {formatGenerationSource(turn.generationSource)}
                              </span>
                            </div>
                            {turn.yielded ? (
                              <span className="turn-yielded-badge" aria-label="Yielded — no new substance">Yielded</span>
                            ) : null}
                          </header>

                          <p className={`turn-meta-line${turn.isModeratorBeat ? " turn-meta-moderator" : ""}`}>
                            {turn.isModeratorBeat ? (
                              <span className="turn-moderator-badge" aria-label="Moderator beat">Moderator</span>
                            ) : null}
                            <span>{headerParts.join(" · ")}</span>
                          </p>

                          <p>{turn.transcript}</p>
                          {turn.yielded && turn.yieldReason ? (
                            <p className="turn-yield-reason">Yield reason: {turn.yieldReason}</p>
                          ) : null}

                          {shouldRenderFactCheck(factChecks?.get(turn.turnId)) ? (
                            <details
                              className="turn-detail turn-detail-factcheck"
                              open
                              title="Expand to see the live fact-check verdict and sources for this reply."
                            >
                              <summary title="Expand to see the live fact-check verdict and sources for this reply.">Live fact-check</summary>
                              <div className="turn-detail-body">
                                <FactCheckCard state={factChecks?.get(turn.turnId)} />
                              </div>
                            </details>
                          ) : null}

                          {turn.sourceExcerpt || turn.citedEvidence.length > 0 ? (
                            <details
                              className="turn-detail"
                              title="Expand to see the source excerpts and evidence the presenter used for this reply."
                            >
                              <summary title="Expand to see the source excerpts and evidence the presenter used for this reply.">Why this answer</summary>
                              <div className="turn-detail-body">
                                {turn.sourceExcerpt ? <p className="turn-source-excerpt">{turn.sourceExcerpt}</p> : null}
                                {turn.citedEvidence.length > 0 ? (
                                  <div className="turn-evidence-list">
                                    {turn.citedEvidence.map((evidence) => (
                                      <div key={`${turn.turnId}-${evidence.channel}-${evidence.timestamp}`} className="turn-evidence-item">
                                        <strong>{evidence.channel}</strong>
                                        <span>{evidence.lean}</span>
                                        <small>{new Date(evidence.timestamp).toLocaleTimeString()}</small>
                                        <p>{evidence.note}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ) : null}
                        </motion.article>
                      );
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.section>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
