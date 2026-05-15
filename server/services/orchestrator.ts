import type {
  AnchorId,
  AnchorProfile,
  DebateConfig,
  DebateRoundPreset,
  FactCheckArticleContext,
  FactCheckResult,
  PanelPacket,
  PanelTurn,
  PriorFactCheck,
  PriorTranscriptExcerpt,
  ResponseGoal,
  SessionTranscriptEntry,
  SourceEvidence,
  StoryPacket,
} from "../../shared/models";
import { anchorIds } from "../../shared/models";
import { buildArticleFallbackResponse } from "./articleSource";
import { buildUnavailableResult, type FactCheckProvider } from "./factCheck/builder";
import type { LiveResponseBuilder } from "./liveResponse";
import type { LiveResponseOverride, LiveResponseYield } from "./liveResponse/provider";
import { bidSpeakingOrder, type BidResult } from "./orchestrator/bidding";
import { AnchorSessionManager } from "../state/sessionManager";

function buildId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clipExcerpt(text: string, maxLength = 140) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}...`;
}

export function labelFor(anchorId: AnchorId): string {
  if (anchorId === "neutral") return "Neutral Desk";
  if (anchorId === "left") return "Left Lens";
  return "Right Lens";
}

export interface ViewerPromptRoute {
  goal: ResponseGoal;
  speakers?: AnchorId[];
  rounds?: DebateRoundPreset;
}

export function routeViewerPrompt(viewerPrompt: string): ViewerPromptRoute {
  const normalized = viewerPrompt.trim().toLowerCase();

  if (normalized.length === 0) {
    return { goal: "latest_change" };
  }

  // Comparison must run FIRST so "how do left and right differ" doesn't misroute to a single side.
  // Note: we set the goal but do NOT auto-bump rounds — rounds stays caller-controlled (UI),
  // so a single "compare me both sides" still runs as one round.
  if (/\b(left and right|right and left|both sides|all three|compare|differ|contrast)\b/.test(normalized)) {
    return { goal: "compare" };
  }
  // Explicit "debate" intent — viewer asks the anchors to argue. Bump to two rounds so we get a rebuttal.
  if (/\bdebate (this|it|them|each other)\b|\bgo back and forth\b|\bargue (it|this) out\b/.test(normalized)) {
    return { goal: "anchor_reply", rounds: 2 };
  }
  if (/^\s*left\b|\b(what|how) (does|is) (the )?left\b|\bthe left\b|\bleft['’]?s view\b|\bleft lens\b/.test(normalized)) {
    return { goal: "left_view", speakers: ["left"] };
  }
  if (/^\s*right\b|\b(what|how) (does|is) (the )?right\b|\bthe right\b|\bright['’]?s view\b|\bright lens\b/.test(normalized)) {
    return { goal: "right_view", speakers: ["right"] };
  }
  if (/\b(respond to|reply to|push back|rebut)\b/.test(normalized)) {
    return { goal: "anchor_reply" };
  }
  if (/\bcatch (me )?up\b|\bbrief me\b|catch-up/.test(normalized)) {
    return { goal: "catch_up", speakers: ["neutral"] };
  }
  if (/\bwhat changed\b|\blatest\b/.test(normalized)) {
    return { goal: "latest_change" };
  }
  return { goal: "custom" };
}

export function inferResponseGoal(viewerPrompt: string): ResponseGoal {
  return routeViewerPrompt(viewerPrompt).goal;
}

export function normalizeDebateConfig(config?: Partial<DebateConfig>): DebateConfig {
  const roundsRaw = config?.debateRounds;
  const debateRounds: DebateRoundPreset = roundsRaw === 2 ? 2 : roundsRaw === 3 ? 3 : 1;
  return {
    tone: config?.tone ?? "balanced",
    openingSpeaker: config?.openingSpeaker ?? "auto",
    debateRounds,
    includeModeratorBeat: config?.includeModeratorBeat ?? true,
  };
}

function getStableSpeakingOrder(selectedAnchors: AnchorId[]): AnchorId[] {
  const deduped = Array.from(new Set(selectedAnchors)).filter((anchorId): anchorId is AnchorId =>
    anchorIds.includes(anchorId),
  );

  if (deduped.length <= 1) {
    return deduped;
  }

  if (deduped.includes("neutral")) {
    const tail = deduped.filter((anchorId) => anchorId !== "neutral").sort((left, right) => {
      const order = ["left", "right"];
      return order.indexOf(left) - order.indexOf(right);
    });
    return ["neutral", ...tail];
  }

  return deduped.sort((left, right) => {
    const order = ["left", "right"];
    return order.indexOf(left) - order.indexOf(right);
  });
}

export function getSpeakingOrder(
  selectedAnchors: AnchorId[],
  openingSpeaker: DebateConfig["openingSpeaker"] = "auto",
): AnchorId[] {
  const stableOrder = getStableSpeakingOrder(selectedAnchors);
  if (openingSpeaker === "auto" || !stableOrder.includes(openingSpeaker)) {
    return stableOrder;
  }

  return [openingSpeaker, ...stableOrder.filter((anchorId) => anchorId !== openingSpeaker)];
}

function fisherYates<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function shuffleSpeakingOrder(
  order: AnchorId[],
  openingSpeaker: DebateConfig["openingSpeaker"] = "auto",
): AnchorId[] {
  if (order.length <= 1) {
    return order;
  }
  // A pinned opening speaker keeps their slot; only the rest gets shuffled.
  if (openingSpeaker !== "auto" && order.includes(openingSpeaker)) {
    const rest = order.filter((anchorId) => anchorId !== openingSpeaker);
    return [openingSpeaker, ...fisherYates(rest)];
  }
  return fisherYates(order);
}

function countAnchorTurns(sessionTranscript: SessionTranscriptEntry[] | undefined): number {
  if (!sessionTranscript) return 0;
  return sessionTranscript.filter((entry) => entry.role === "anchor").length;
}

function buildSafetyGuardrail(storyPacket: StoryPacket) {
  if (storyPacket.ad_safety_state === "unsafe") {
    return "Unsafe visuals or rhetoric detected. Keep language restrained and note that sponsor-safe automation is paused.";
  }
  if (storyPacket.ad_safety_state === "caution") {
    return "Caution state. Avoid sensational language and note that sponsor-safe automation is limited.";
  }
  return "Safe state. Keep claims grounded and concise.";
}

function buildPanelPacket(
  storyPacket: StoryPacket,
  selectedAnchors: AnchorId[],
  speakingOrder: AnchorId[],
  priorTranscriptExcerpts: PriorTranscriptExcerpt[],
  responseGoal: ResponseGoal,
  debateConfig: DebateConfig,
  sessionTranscript?: SessionTranscriptEntry[],
  priorFactChecks?: PriorFactCheck[],
  closingDirective?: string,
): PanelPacket {
  return {
    storyPacket,
    selectedAnchors,
    speakingOrder,
    priorTranscriptExcerpts,
    priorFactChecks,
    sessionTranscript,
    responseGoal,
    debateConfig,
    safetyGuardrail: buildSafetyGuardrail(storyPacket),
    confidence: storyPacket.confidence,
    closingDirective,
  };
}

function buildFactCheckArticleContext(storyPacket: StoryPacket, anchorId: AnchorId): FactCheckArticleContext | undefined {
  if (storyPacket.sourceType !== "article") return undefined;
  const lensFraming =
    anchorId === "left"
      ? storyPacket.left_framing_summary
      : anchorId === "right"
        ? storyPacket.right_framing_summary
        : undefined;
  const body = storyPacket.articleBody ?? "";
  return {
    sourceUrl: storyPacket.sourceUrl,
    sourceTitle: storyPacket.sourceTitle,
    sourceDomain: storyPacket.sourceDomain,
    neutralSummary: storyPacket.neutral_summary,
    lensFraming,
    articleExcerpt: body.length > 2000 ? `${body.slice(0, 2000).trimEnd()}...` : body || undefined,
  };
}

function pickEvidence(storyPacket: StoryPacket, anchorId: AnchorId) {
  return (
    storyPacket.source_evidence.find((evidence) => evidence.lean === anchorId) ??
    storyPacket.source_evidence.find((evidence) => evidence.lean === "neutral")
  );
}

function pickTemplateEvidence(storyPacket: StoryPacket, anchorId: AnchorId): SourceEvidence[] {
  const preferred = storyPacket.source_evidence.filter((evidence) => evidence.lean === anchorId);
  const neutral = storyPacket.source_evidence.filter((evidence) => evidence.lean === "neutral");
  const combined = [...preferred, ...neutral];

  return combined.filter((evidence, index) => combined.indexOf(evidence) === index).slice(0, 2);
}

function buildNeutralResponse(packet: PanelPacket): string {
  const { storyPacket, responseGoal, priorTranscriptExcerpts } = packet;
  const consensus = storyPacket.consensus_points.slice(0, 2).join(" ");
  const divergence = storyPacket.divergence_points.slice(0, 2).join(" ");
  const prior = priorTranscriptExcerpts.at(-1);
  const replyLead = prior
    ? `Neutral Desk to ${labelFor(prior.anchorId)}: `
    : "";
  const goalLead =
    responseGoal === "catch_up"
      ? `What we can say with confidence is the quick catch-up — ${storyPacket.neutral_summary}`
      : responseGoal === "compare"
        ? `What we can say with confidence is the current cross-channel picture: ${storyPacket.neutral_summary}`
        : `What we can say with confidence is what changed: ${storyPacket.neutral_summary}`;
  const safetyLine =
    storyPacket.ad_safety_state === "unsafe"
      ? " Sponsor-safe automation is paused while the coverage stays confrontational."
      : storyPacket.ad_safety_state === "caution"
        ? " Sponsor-safe automation is in caution mode."
        : " Sponsor-safe automation is available for neutral-led recaps.";
  const confidenceLine =
    storyPacket.confidence < 0.8 ? " Confidence is still developing, so I am treating this as provisional." : "";
  const toneLine =
    packet.debateConfig.tone === "aggressive"
      ? " The disagreement is sharp, but the factual base is still narrow."
      : packet.debateConfig.tone === "calm"
        ? " I am keeping the read measured while the details settle."
        : "";
  return `${replyLead}${goalLead} Consensus right now: ${consensus} Divergence: ${divergence}${safetyLine}${confidenceLine}${toneLine}`;
}

function buildLensResponse(anchor: AnchorProfile, packet: PanelPacket): string {
  const { storyPacket, priorTranscriptExcerpts } = packet;
  const prior = priorTranscriptExcerpts.at(-1);
  const replyLead = prior
    ? `${labelFor(anchor.id)} to ${labelFor(prior.anchorId)}: `
    : "";
  const leadIn =
    anchor.id === "left"
      ? "The left-leaning read is"
      : "The right-leaning read is";
  const framing =
    anchor.id === "left" ? storyPacket.left_framing_summary : storyPacket.right_framing_summary;
  const divergence = storyPacket.divergence_points[0] ?? "";
  const safety =
    storyPacket.ad_safety_state === "unsafe"
      ? " Safety remains high risk, so I am keeping this to framing rather than escalation."
      : "";
  const confidence =
    storyPacket.confidence < 0.8 ? " This framing read is directional, not final." : "";
  const splitLead =
    packet.debateConfig.tone === "aggressive"
      ? "The sharpest split versus the other coverage cluster is this: "
      : "The clearest split versus the other coverage cluster is this: ";
  const divergenceTail = divergence ? `${splitLead}${divergence}.` : "";
  return `${replyLead}${leadIn} ${framing} ${divergenceTail}${safety}${confidence}`.replace(/\s+/g, " ").trim();
}

function buildAnchorResponse(anchor: AnchorProfile, packet: PanelPacket): string {
  if (anchor.id === "neutral") {
    return buildNeutralResponse(packet);
  }

  return buildLensResponse(anchor, packet);
}

function buildTemplateTurn(anchor: AnchorProfile, packet: PanelPacket) {
  return {
    transcript: buildAnchorResponse(anchor, packet),
    citedEvidence: pickTemplateEvidence(packet.storyPacket, anchor.id),
    generationSource: "template_fallback" as const,
  };
}

interface GeneratedTurn {
  transcript: string;
  citedEvidence: SourceEvidence[];
  generationSource: PanelTurn["generationSource"];
  yield?: LiveResponseYield;
}

export async function orchestratePanel(options: {
  selectedAnchors: AnchorId[];
  viewerPrompt: string;
  storyPacket: StoryPacket;
  anchorProfiles: Record<AnchorId, AnchorProfile>;
  sessionManager: AnchorSessionManager;
  liveResponseBuilder?: LiveResponseBuilder;
  factCheckProvider?: FactCheckProvider;
  debateConfig?: Partial<DebateConfig>;
  sessionTranscript?: SessionTranscriptEntry[];
  llmOverride?: LiveResponseOverride;
  onTurn?: (turn: PanelTurn) => void | Promise<void>;
}): Promise<PanelTurn[]> {
  const { viewerPrompt, storyPacket, anchorProfiles, sessionManager, liveResponseBuilder, factCheckProvider, onTurn } = options;
  const sessionTranscript = options.sessionTranscript;
  const llmOverride = options.llmOverride;
  const callerSelectedAnchors = options.selectedAnchors;
  const route = routeViewerPrompt(viewerPrompt);
  const responseGoal = route.goal;
  // If the route narrows to specific speakers (e.g. "what does Left think?"), intersect with
  // what the caller selected. If the intersection is empty, fall back to the route's speakers
  // outright — direct-address intent wins over a stale selection.
  const routedSpeakers = route.speakers;
  const intersected = routedSpeakers ? callerSelectedAnchors.filter((id) => routedSpeakers.includes(id)) : null;
  const selectedAnchors: AnchorId[] = intersected
    ? intersected.length > 0
      ? intersected
      : routedSpeakers!
    : callerSelectedAnchors;
  const baseDebateConfig = normalizeDebateConfig(options.debateConfig);
  // The route can bump rounds (e.g. "compare" → 2 rounds), but only upward; never shrink.
  const debateConfig: DebateConfig =
    route.rounds && route.rounds > baseDebateConfig.debateRounds
      ? { ...baseDebateConfig, debateRounds: route.rounds }
      : baseDebateConfig;
  const deterministicOrder = getSpeakingOrder(selectedAnchors, debateConfig.openingSpeaker);
  // Round 1 (no prior anchor turns yet): shuffle so we don't always lead with the
  // same anchor. Round 2+: hand off to the LLM bidder, which uses the transcript
  // to pick who should rebut whom.
  const bidResult: BidResult =
    countAnchorTurns(sessionTranscript) >= 2
      ? await bidSpeakingOrder({
          selectedAnchors,
          deterministicOrder,
          anchorProfiles,
          viewerPrompt,
          sessionTranscript,
          debateConfig,
          liveResponseBuilder,
          override: llmOverride,
        })
      : {
          order: shuffleSpeakingOrder(deterministicOrder, debateConfig.openingSpeaker),
          source: "random",
        };
  const speakingOrder = bidResult.order;
  const transcriptChars = (sessionTranscript ?? []).reduce((sum, entry) => sum + entry.text.length, 0);
  console.log(
    `[orchestrate] sessionTranscript=${(sessionTranscript ?? []).length} entries (~${transcriptChars} chars), bidder=${bidResult.source}, order=[${speakingOrder.join(",")}]`,
  );
  const turns: PanelTurn[] = [];
  const allPriorExcerpts: PriorTranscriptExcerpt[] = [];
  const priorFactChecks: PriorFactCheck[] = [];

  async function generateTurnFor(
    anchor: AnchorProfile,
    panelPacket: PanelPacket,
    turnResponseGoal: ResponseGoal,
  ): Promise<GeneratedTurn> {
    const priorForArticle = panelPacket.priorTranscriptExcerpts;
    if (storyPacket.sourceType === "article") {
      if (liveResponseBuilder) {
        try {
          const built = await liveResponseBuilder.buildArticleTurn(
            anchor,
            storyPacket,
            viewerPrompt,
            turnResponseGoal,
            {
              selectedAnchors,
              speakingOrder,
              priorTranscriptExcerpts: priorForArticle,
              debateConfig,
              sessionTranscript,
              priorFactChecks: panelPacket.priorFactChecks,
            },
            llmOverride,
          );
          return {
            transcript: built.transcript,
            citedEvidence: built.citedEvidence,
            generationSource: built.generationSource,
            yield: built.yield,
          };
        } catch (error) {
          console.warn(
            `[orchestrator] LLM article turn failed for anchor=${anchor.id} — using keyword fallback`,
            error,
          );
          const fallback = buildArticleFallbackResponse(storyPacket, viewerPrompt, anchor, {
            priorExcerpt: priorForArticle.at(-1)?.text,
            tone: debateConfig.tone,
          });
          return {
            transcript: fallback.transcript,
            citedEvidence: fallback.sourceExcerpt
              ? storyPacket.source_evidence.filter((evidence) => {
                  const normalizedExcerpt = fallback.sourceExcerpt?.trim().toLowerCase() ?? "";
                  const normalizedNote = evidence.note.toLowerCase();
                  return normalizedNote.includes(normalizedExcerpt) || normalizedExcerpt.includes(normalizedNote);
                })
              : [],
            generationSource: "article" as const,
          };
        }
      }

      const fallback = buildArticleFallbackResponse(storyPacket, viewerPrompt, anchor, {
        priorExcerpt: priorForArticle.at(-1)?.text,
        tone: debateConfig.tone,
      });
      return {
        transcript: fallback.transcript,
        citedEvidence: fallback.sourceExcerpt
          ? storyPacket.source_evidence.filter((evidence) => {
              const normalizedExcerpt = fallback.sourceExcerpt?.trim().toLowerCase() ?? "";
              const normalizedNote = evidence.note.toLowerCase();
              return normalizedNote.includes(normalizedExcerpt) || normalizedExcerpt.includes(normalizedNote);
            })
          : [],
        generationSource: "article" as const,
      };
    }

    if (storyPacket.sourceType === "live_feed" && liveResponseBuilder) {
      try {
        const built = await liveResponseBuilder.buildTurn(anchor, panelPacket, llmOverride);
        return {
          transcript: built.transcript,
          citedEvidence: built.citedEvidence,
          generationSource: built.generationSource,
          yield: built.yield,
        };
      } catch (error) {
        console.warn(
          `[orchestrator] LLM live-feed turn failed for anchor=${anchor.id} — using template fallback`,
          error,
        );
        return buildTemplateTurn(anchor, panelPacket);
      }
    }

    return buildTemplateTurn(anchor, panelPacket);
  }

  function startFactCheck(turnId: string, anchorId: AnchorId, transcript: string): Promise<FactCheckResult> {
    if (!factCheckProvider || !factCheckProvider.available) {
      return Promise.resolve(buildUnavailableResult(turnId, "Fact-check provider unavailable."));
    }
    return factCheckProvider
      .factCheck({
        turnId,
        transcript,
        storyTitle: storyPacket.title,
        storyTopic: storyPacket.topic,
        anchorLean: anchorId,
        articleContext: buildFactCheckArticleContext(storyPacket, anchorId),
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return buildUnavailableResult(turnId, `Fact-check failed: ${message}`);
      });
  }

  function recordFactCheckForPrompt(anchorId: AnchorId, anchorLabel: string, result: FactCheckResult) {
    if (result.mode !== "grounded" || result.claims.length === 0) return;
    priorFactChecks.push({
      anchorId,
      anchorLabel,
      confidence: result.confidence,
      claims: result.claims,
    });
    // Cap window: keep last 6 claims worth across entries to bound prompt growth.
    let totalClaims = 0;
    for (let i = priorFactChecks.length - 1; i >= 0; i -= 1) {
      totalClaims += priorFactChecks[i].claims.length;
      if (totalClaims > 6) {
        priorFactChecks.splice(0, i);
        return;
      }
    }
  }

  for (let round = 0; round < debateConfig.debateRounds; round++) {
    for (const anchorId of speakingOrder) {
      const anchor = anchorProfiles[anchorId];
      // Show the anchor every peer turn so far this session — windowing earlier rounds out
      // produced paraphrases because the speaker literally couldn't see what was already said.
      // Per-turn text is already clipped to ~220 chars in the prompt, so a 3×3 debate is ~1.8KB.
      const windowedPrior: PriorTranscriptExcerpt[] = allPriorExcerpts.filter(
        (excerpt) => excerpt.anchorId !== anchorId,
      );
      // Reply target: most recent peer prior turn (the window is already self-free).
      const replyTarget = windowedPrior[windowedPrior.length - 1];
      const panelPacket = buildPanelPacket(
        storyPacket,
        selectedAnchors,
        speakingOrder,
        windowedPrior,
        responseGoal,
        debateConfig,
        sessionTranscript,
        // Mirror the same self-exclusion the transcript window uses: an anchor shouldn't
        // see fact-check notes on their own prior claims.
        priorFactChecks.filter((entry) => entry.anchorId !== anchorId),
      );
      const generatedTurn = await generateTurnFor(anchor, panelPacket, responseGoal);
      const transcript = generatedTurn.transcript;
      const turnId = buildId("turn");
      const isYielded = Boolean(generatedTurn.yield?.reason);
      // Fire fact-check in parallel with TTS playback so the next anchor's prompt can
      // include the result without paying extra latency. Skip fact-checking yields:
      // a yield is a handoff sentence, not a factual claim.
      const factCheckPromise = isYielded
        ? Promise.resolve(buildUnavailableResult(turnId, "Yielded turn — fact-check skipped."))
        : startFactCheck(turnId, anchorId, transcript);
      const events = await sessionManager.speak(anchorId, transcript);
      const factCheck = await factCheckPromise;
      const startedAt = new Date().toISOString();
      const completedAt = new Date().toISOString();
      const priorAnchor = windowedPrior.at(-1);
      const sourceExcerpt =
        priorAnchor?.text
          ? clipExcerpt(priorAnchor.text)
          : generatedTurn.citedEvidence[0]?.note ?? pickEvidence(storyPacket, anchorId)?.note;

      const newTurn: PanelTurn = {
        turnId,
        anchorId,
        anchorLabel: anchor.label,
        responseGoal,
        transcript,
        citedEvidence: generatedTurn.citedEvidence,
        generationSource: generatedTurn.generationSource,
        priorAnchorId: priorAnchor?.anchorId,
        replyToAnchorId: replyTarget?.anchorId,
        roundIndex: round,
        yielded: isYielded || undefined,
        yieldReason: generatedTurn.yield?.reason,
        sourceExcerpt,
        startedAt,
        completedAt,
        events,
        factCheck: factCheck.mode === "grounded" ? factCheck : undefined,
      };
      turns.push(newTurn);
      if (onTurn) {
        await onTurn(newTurn);
      }

      // Yielded turns are spoken (single handoff sentence) but they are NOT substantive
      // content. Don't add them to allPriorExcerpts — subsequent anchors shouldn't
      // "reply to" a handoff. Same logic for fact-checks: nothing factual to check.
      if (!isYielded) {
        allPriorExcerpts.push({ anchorId, text: transcript, roundIndex: round });
        recordFactCheckForPrompt(anchorId, anchor.label, factCheck);
      }
    }

    // Topic-exhaustion detection: when ≥ 50% of this round's anchor turns yielded,
    // the desk has converged — wrap with a closing segue (if neutral is selected)
    // and break out of the round loop rather than forcing another round of paraphrase.
    const turnsInRound = turns.filter((t) => t.roundIndex === round && !t.isModeratorBeat);
    const yieldsInRound = turnsInRound.filter((t) => t.yielded).length;
    const exhausted = turnsInRound.length > 0 && yieldsInRound * 2 >= turnsInRound.length;
    const isFinalRound = round === debateConfig.debateRounds - 1;
    const neutralSelected = selectedAnchors.includes("neutral");

    // Standard moderator beat between rounds (existing behavior — unchanged when not exhausted).
    const shouldModerate =
      !exhausted &&
      debateConfig.includeModeratorBeat &&
      debateConfig.debateRounds > 1 &&
      neutralSelected &&
      selectedAnchors.length === 3;

    // Closing segue overrides the user's moderator-beat setting on exhaustion, but only
    // when neutral is selected (no graceful close otherwise — break silently).
    const shouldSegue = exhausted && !isFinalRound && neutralSelected;

    if (shouldModerate || shouldSegue) {
      const modPrior = allPriorExcerpts.filter((excerpt) => excerpt.anchorId !== "neutral").slice(-2);
      const neutralAnchor = anchorProfiles["neutral"];
      const closingDirective = shouldSegue
        ? [
            "The desk has converged on this topic. Deliver a short transitional beat (1 sentence, under 20 words).",
            "Acknowledge the convergence, then offer to take a new angle or invite a viewer follow-up.",
            "Examples: \"That looks like the read — anything else worth pulling on here?\" or \"Convergence on the verification — moving on unless someone has a new angle.\"",
            "Do NOT introduce new factual claims. Do NOT recap individual anchors.",
          ].join(" ")
        : undefined;
      const modPanelPacket = buildPanelPacket(
        storyPacket,
        selectedAnchors,
        speakingOrder,
        modPrior,
        "compare",
        debateConfig,
        sessionTranscript,
        priorFactChecks.filter((entry) => entry.anchorId !== "neutral"),
        closingDirective,
      );
      const modTurn = await generateTurnFor(neutralAnchor, modPanelPacket, "compare");
      const modTurnId = buildId("turn");
      const modIsYielded = Boolean(modTurn.yield?.reason);
      const modFactCheckPromise = modIsYielded
        ? Promise.resolve(buildUnavailableResult(modTurnId, "Yielded turn — fact-check skipped."))
        : startFactCheck(modTurnId, "neutral", modTurn.transcript);
      const modEvents = await sessionManager.speak("neutral", modTurn.transcript);
      const modFactCheck = await modFactCheckPromise;
      const modPriorAnchor = modPrior.at(-1);
      const modPanelTurn: PanelTurn = {
        turnId: modTurnId,
        anchorId: "neutral",
        anchorLabel: neutralAnchor.label,
        responseGoal: "compare",
        transcript: modTurn.transcript,
        citedEvidence: modTurn.citedEvidence,
        generationSource: modTurn.generationSource,
        priorAnchorId: modPriorAnchor?.anchorId,
        replyToAnchorId: modPriorAnchor?.anchorId,
        roundIndex: round,
        isModeratorBeat: true,
        yielded: modIsYielded || undefined,
        yieldReason: modTurn.yield?.reason,
        sourceExcerpt: modPriorAnchor?.text ? clipExcerpt(modPriorAnchor.text) : undefined,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        events: modEvents,
        factCheck: modFactCheck.mode === "grounded" ? modFactCheck : undefined,
      };
      turns.push(modPanelTurn);
      if (onTurn) {
        await onTurn(modPanelTurn);
      }
      if (!modIsYielded) {
        allPriorExcerpts.push({ anchorId: "neutral", text: modTurn.transcript, roundIndex: round });
        recordFactCheckForPrompt("neutral", neutralAnchor.label, modFactCheck);
      }
    }

    if (exhausted && !isFinalRound) {
      break;
    }
  }

  return turns;
}
