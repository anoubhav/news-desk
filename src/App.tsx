import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  AnchorId,
  AnchorProfile,
  AnchorRuntimeStatus,
  AnchorSession,
  BrowserSessionEvent,
  DebateConfig,
  DebateOpeningSpeaker,
  FactCheckArticleContext,
  LivePacketResponse,
  LlmOverride,
  OrchestrateStreamFrame,
  PanelTurn,
  SessionTranscriptEntry,
  SourceType,
  StoryPacket,
  VoiceCaptureState,
} from "@shared/models";
import { api } from "./lib/api";
import { getCompositionLabel, toggleAnchor } from "./lib/layout";
import {
  AgentEventsEnum,
  createBrowserLiveSession,
  LiveAvatarSession,
  LiveSessionEvent,
  VoiceChatEvent,
  interruptSession,
  repeatAndWait,
  startVoiceCapture,
  stopVoiceCapture,
  waitForStreamReady,
} from "./lib/liveavatar";
import { AnchorCard } from "./components/AnchorCard";
import { ComposerPanel } from "./components/ComposerPanel";
import { AvatarGalleryModal } from "./components/AvatarGalleryModal";
import { ControlPanel } from "./components/ControlPanel";
import { PanelTurns } from "./components/PanelTurns";
import type { FactCheckCardState } from "./components/FactCheckCard";
import { StoryInspector } from "./components/StoryInspector";
import { NewsroomHud } from "./components/NewsroomHud";
import { HighlightReelPanel } from "./components/HighlightReelPanel";
import { useHudBindings } from "./lib/useHudBindings";
import { attachHighlightRecorder, type HighlightRecorder } from "./lib/highlightRecorder";

const playbackDelayMs = 80;
const defaultArticlePrompt =
  "Tell me the story in a clear, engaging way. Lead with the main development, explain why it matters, and end with what to watch next.";
const defaultPanelPrompt = "What changed?";
const voiceReleaseGraceMs = 600;
const defaultDebateConfig: DebateConfig = {
  tone: "balanced",
  openingSpeaker: "auto",
  debateRounds: 1,
  includeModeratorBeat: true,
};

const defaultLlmConfig: LlmOverride = { modelPreset: "default" };
const llmConfigStorageKey = "liveavatar:llmConfig";

function loadStoredLlmConfig(): LlmOverride {
  if (typeof window === "undefined") return defaultLlmConfig;
  try {
    const raw = window.localStorage.getItem(llmConfigStorageKey);
    if (!raw) return defaultLlmConfig;
    const parsed = JSON.parse(raw) as Partial<LlmOverride>;
    const modelPreset = parsed.modelPreset === "gpt-5.5" ? "gpt-5.5" : "default";
    const allowedEffort = ["low", "medium", "high", "xhigh"] as const;
    const reasoningEffort =
      parsed.reasoningEffort && allowedEffort.includes(parsed.reasoningEffort)
        ? parsed.reasoningEffort
        : undefined;
    return { modelPreset, reasoningEffort };
  } catch {
    return defaultLlmConfig;
  }
}

type LiveStatus = Omit<LivePacketResponse, "fetchedAt"> & {
  fetchedAt?: string;
  errorMessage?: string;
  errorCode?: string;
  lastSuccessfulFetchedAt?: string;
};

type QuestionSource = "typed" | "voice";
type QuestionStatus = "recording" | "transcribing" | "answering" | "done" | "failed";

interface ConversationPrompt {
  id: string;
  text: string;
  source: QuestionSource;
  status: QuestionStatus;
}

interface ConversationGroup {
  id: string;
  prompt: ConversationPrompt;
  turns: PanelTurn[];
}

function buildSessionTranscript(groups: ConversationGroup[]): SessionTranscriptEntry[] {
  const out: SessionTranscriptEntry[] = [];
  for (const group of groups) {
    const promptText = group.prompt.text.trim();
    if (promptText) {
      out.push({ role: "host", text: promptText });
    }
    for (const turn of group.turns) {
      const transcript = turn.transcript?.trim();
      if (!transcript) continue;
      out.push({
        role: "anchor",
        anchorId: turn.anchorId,
        anchorLabel: turn.anchorLabel,
        text: transcript,
        roundIndex: turn.roundIndex,
        startedAt: turn.startedAt,
        replyToAnchorId: turn.replyToAnchorId,
      });
    }
  }
  return out;
}

interface VoiceTurnState {
  questionId: string;
  responseId: number;
  anchorId: AnchorId;
  sessionId: string;
  released: boolean;
  submitted: boolean;
}

function delay(time: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, time);
  });
}

function buildRelayEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `relay-${Math.random().toString(36).slice(2, 10)}`;
}

function buildQuestionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `question-${Math.random().toString(36).slice(2, 10)}`;
}

function resumeMediaElement(element: HTMLVideoElement | null | undefined) {
  if (!element) {
    return;
  }

  void element.play().catch(() => undefined);
}

function buildLiveSessionKey(session: AnchorSession) {
  return session.sessionId;
}

function getDefaultPrompt(sourceMode: SourceType) {
  return sourceMode === "article" ? defaultArticlePrompt : defaultPanelPrompt;
}

function formatLiveStatusLabel(status: LiveStatus["status"]) {
  return status.replaceAll("_", " ");
}

function isVoiceCaptureActive(state: VoiceCaptureState) {
  return state === "preparing" || state === "listening" || state === "transcribing" || state === "submitting";
}

function sortAnchorIds(left: AnchorId, right: AnchorId) {
  const order: AnchorId[] = ["left", "right"];
  return order.indexOf(left) - order.indexOf(right);
}

function getStableSpeakingOrder(selectedAnchors: AnchorId[]) {
  if (selectedAnchors.includes("neutral")) {
    return ["neutral", ...selectedAnchors.filter((anchorId) => anchorId !== "neutral").sort(sortAnchorIds)] as AnchorId[];
  }

  return [...selectedAnchors].sort(sortAnchorIds);
}

function getDebateSpeakingOrder(
  selectedAnchors: AnchorId[],
  openingSpeaker: DebateOpeningSpeaker,
) {
  const stableOrder = getStableSpeakingOrder(selectedAnchors);
  if (openingSpeaker === "auto" || !stableOrder.includes(openingSpeaker)) {
    return stableOrder;
  }

  return [openingSpeaker, ...stableOrder.filter((anchorId) => anchorId !== openingSpeaker)];
}

function getStageStarterAnchorId(
  selectedAnchors: AnchorId[],
  openingSpeaker: DebateOpeningSpeaker,
) {
  return getDebateSpeakingOrder(selectedAnchors, openingSpeaker)[0] ?? selectedAnchors[0] ?? "neutral";
}

function resolveVoiceCandidateAnchorId(sourceMode: SourceType, selectedAnchors: AnchorId[]) {
  if (sourceMode === "demo_story") {
    return null;
  }

  if (sourceMode === "article") {
    return selectedAnchors.includes("neutral") ? "neutral" : getStableSpeakingOrder(selectedAnchors)[0] ?? "neutral";
  }

  return selectedAnchors.includes("neutral") ? "neutral" : getStableSpeakingOrder(selectedAnchors)[0] ?? "neutral";
}

function resolveVoiceInputAnchorId(
  sourceMode: SourceType,
  selectedAnchors: AnchorId[],
) {
  return resolveVoiceCandidateAnchorId(sourceMode, selectedAnchors);
}

export default function App() {
  const [anchors, setAnchors] = useState<AnchorProfile[]>([]);
  const [anchorRuntimeStatus, setAnchorRuntimeStatus] = useState<Record<AnchorId, AnchorRuntimeStatus> | null>(null);
  const [sessions, setSessions] = useState<Record<AnchorId, AnchorSession> | null>(null);
  const [selectedAnchors, setSelectedAnchors] = useState<AnchorId[]>(["neutral"]);
  const [stories, setStories] = useState<StoryPacket[]>([]);
  const [storyPacket, setStoryPacket] = useState<StoryPacket | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceType>("demo_story");
  const [articleUrl, setArticleUrl] = useState("");
  const [articleError, setArticleError] = useState<string | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [liveFeedEnabled, setLiveFeedEnabled] = useState(false);
  const [liveFeedPollMs, setLiveFeedPollMs] = useState(5000);
  const [loadingLivePacket, setLoadingLivePacket] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({
    storyPacket: null,
    status: "misconfigured",
    stale: false,
    upstreamAvailable: false,
    errorCode: "misconfigured",
  });
  const [demoStoryId, setDemoStoryId] = useState("");
  const [viewerPrompt, setViewerPrompt] = useState(defaultPanelPrompt);
  const [debateConfig, setDebateConfig] = useState<DebateConfig>(defaultDebateConfig);
  const [llmConfig, setLlmConfig] = useState<LlmOverride>(() => loadStoredLlmConfig());
  const [conversationGroups, setConversationGroups] = useState<ConversationGroup[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<ConversationPrompt | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<AnchorId | null>(null);
  const [activeTurnContext, setActiveTurnContext] = useState<{
    replyToAnchorId?: AnchorId;
    roundIndex: number;
    isModeratorBeat?: boolean;
  } | null>(null);
  const [factChecks, setFactChecks] = useState<Map<string, FactCheckCardState>>(() => new Map());
  const [voiceCaptureState, setVoiceCaptureState] = useState<VoiceCaptureState>("idle");
  const [voiceDraftTranscript, setVoiceDraftTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [activeVoiceAnchorId, setActiveVoiceAnchorId] = useState<AnchorId | null>(null);
  const [providerMode, setProviderMode] = useState("mock");
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectingFeeds, setConnectingFeeds] = useState(false);
  const [avatarGalleryOpen, setAvatarGalleryOpen] = useState(false);
  const [chromaKeyEnabled, setChromaKeyEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("live-avatar/chromakey") === "on";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("live-avatar/chromakey", chromaKeyEnabled ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, [chromaKeyEnabled]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [liveTimerSeconds, setLiveTimerSeconds] = useState(0);
  const liveSessionsRef = useRef(new Map<AnchorId, LiveAvatarSession>());
  const liveSessionKeysRef = useRef(new Map<AnchorId, string>());
  const pendingLiveSessionsRef = useRef(new Map<AnchorId, Promise<LiveAvatarSession | null>>());
  const heartbeatTimersRef = useRef(new Map<AnchorId, ReturnType<typeof setInterval>>());
  const mediaElementsRef = useRef<Partial<Record<AnchorId, HTMLVideoElement | null>>>({});
  const highlightRecordersRef = useRef<Partial<Record<AnchorId, HighlightRecorder>>>({});
  const highlightSessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `reel-${crypto.randomUUID()}`
      : `reel-${Math.random().toString(36).slice(2)}`,
  );
  const liveRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const storyPacketRef = useRef<StoryPacket | null>(null);
  const sessionsRef = useRef<Record<AnchorId, AnchorSession> | null>(null);
  const sourceModeRef = useRef<SourceType>("demo_story");
  const selectedAnchorsRef = useRef<AnchorId[]>(["neutral"]);
  const debateConfigRef = useRef<DebateConfig>(defaultDebateConfig);
  const llmConfigRef = useRef<LlmOverride>(defaultLlmConfig);
  const providerModeRef = useRef<string>("mock");
  const voiceCaptureStateRef = useRef<VoiceCaptureState>("idle");
  const voiceTranscriptRef = useRef<string | null>(null);
  const voiceSubmitGuardRef = useRef<string | null>(null);
  const voicePointerHeldRef = useRef(false);
  const voiceHotkeyHeldRef = useRef(false);
  const voiceStartInFlightRef = useRef(false);
  const activeVoiceAnchorIdRef = useRef<AnchorId | null>(null);
  const activeQuestionRef = useRef<ConversationPrompt | null>(null);
  const activeResponseIdRef = useRef(0);
  const voiceReleaseTimeoutRef = useRef<number | null>(null);
  const voicePartialTranscriptRef = useRef("");
  const voiceTurnRef = useRef<VoiceTurnState | null>(null);

  function setCurrentVoiceAnchor(anchorId: AnchorId | null) {
    activeVoiceAnchorIdRef.current = anchorId;
    setActiveVoiceAnchorId(anchorId);
  }

  function setCurrentQuestion(question: ConversationPrompt | null) {
    activeQuestionRef.current = question;
    setActiveQuestion(question);
  }

  function syncQuestion(questionId: string, updates: Partial<ConversationPrompt>) {
    if (activeQuestionRef.current?.id === questionId) {
      setCurrentQuestion({
        ...activeQuestionRef.current,
        ...updates,
      });
    }

    setConversationGroups((existingGroups) =>
      existingGroups.map((group) =>
        group.id === questionId
          ? {
              ...group,
              prompt: {
                ...group.prompt,
                ...updates,
              },
            }
          : group,
      ),
    );
  }

  function upsertConversationGroup(question: ConversationPrompt) {
    setConversationGroups((existingGroups) => {
      const existingIndex = existingGroups.findIndex((group) => group.id === question.id);
      if (existingIndex === -1) {
        return [
          ...existingGroups,
          {
            id: question.id,
            prompt: question,
            turns: [],
          },
        ];
      }

      const nextGroups = [...existingGroups];
      nextGroups[existingIndex] = {
        ...nextGroups[existingIndex],
        prompt: {
          ...nextGroups[existingIndex].prompt,
          ...question,
        },
      };
      return nextGroups;
    });
  }

  function appendConversationTurn(questionId: string, turn: PanelTurn) {
    setConversationGroups((existingGroups) =>
      existingGroups.map((group) =>
        group.id === questionId
          ? {
              ...group,
              turns: [...group.turns, turn],
            }
          : group,
      ),
    );
  }

  function clearVoiceReleaseTimeout() {
    if (voiceReleaseTimeoutRef.current !== null) {
      window.clearTimeout(voiceReleaseTimeoutRef.current);
      voiceReleaseTimeoutRef.current = null;
    }
  }

  function beginQuestion(
    text: string,
    source: QuestionSource,
    status: QuestionStatus,
    options?: {
      questionId?: string;
      addToFeed?: boolean;
    },
  ) {
    const question: ConversationPrompt = {
      id: options?.questionId ?? buildQuestionId(),
      text,
      source,
      status,
    };

    setCurrentQuestion(question);
    if (options?.addToFeed) {
      upsertConversationGroup(question);
    }

    return question;
  }

  function interruptCurrentResponse(anchorIds: AnchorId[], reason: string) {
    const previousResponseId = activeResponseIdRef.current;
    activeResponseIdRef.current += 1;
    console.warn(
      `[liveavatar] interruptCurrentResponse reason=${reason} previousResponseId=${previousResponseId} nextResponseId=${activeResponseIdRef.current} anchors=${anchorIds.join(",") || "(none)"}`,
    );
    clearVoiceReleaseTimeout();

    if (providerModeRef.current === "full-api" && sourceModeRef.current !== "demo_story") {
      interruptSelectedPlayback(anchorIds);
    }

    setActiveSpeaker(null);
    setActiveTurnContext(null);

    const currentQuestion = activeQuestionRef.current;
    if (currentQuestion?.status === "answering") {
      syncQuestion(currentQuestion.id, { status: "done" });
    }

    setCurrentQuestion(null);
    return activeResponseIdRef.current;
  }

  function resetVoiceState() {
    clearVoiceReleaseTimeout();
    voicePointerHeldRef.current = false;
    voiceHotkeyHeldRef.current = false;
    voiceStartInFlightRef.current = false;
    voiceTranscriptRef.current = null;
    voicePartialTranscriptRef.current = "";
    voiceSubmitGuardRef.current = null;
    voiceTurnRef.current = null;
    setCurrentVoiceAnchor(null);
    setVoiceCaptureState("idle");
    setVoiceDraftTranscript("");
    setVoiceError(null);
  }

  function clearPanelState() {
    setConversationGroups([]);
    setCurrentQuestion(null);
    setActiveSpeaker(null);
    setActiveTurnContext(null);
    setFactChecks(new Map());
  }

  function resetPanelState() {
    activeResponseIdRef.current += 1;
    clearPanelState();
  }

  function clearLiveSessionRefs(anchorId: AnchorId) {
    pendingLiveSessionsRef.current.delete(anchorId);
    liveSessionsRef.current.delete(anchorId);
    liveSessionKeysRef.current.delete(anchorId);
    stopHeartbeat(anchorId);
  }

  function stopHeartbeat(anchorId: AnchorId) {
    const timer = heartbeatTimersRef.current.get(anchorId);
    if (timer) {
      clearInterval(timer);
      heartbeatTimersRef.current.delete(anchorId);
    }
  }

  function startHeartbeat(anchorId: AnchorId, session: LiveAvatarSession) {
    stopHeartbeat(anchorId);
    // Platform sessions die after 5 min of inactivity. Ping every 2 min to leave
    // one missed-ping of headroom under the cliff.
    const timer = setInterval(() => {
      const current = liveSessionsRef.current.get(anchorId);
      if (current !== session) {
        stopHeartbeat(anchorId);
        return;
      }
      session.keepAlive().catch((error) => {
        console.warn(`[liveavatar] keep-alive failed for ${anchorId}`, error);
        stopHeartbeat(anchorId);
        setSessions((existingSessions) => {
          if (!existingSessions) return existingSessions;
          return {
            ...existingSessions,
            [anchorId]: { ...existingSessions[anchorId], liveReady: false },
          };
        });
        void stopLiveSession(anchorId).catch(() => undefined);
        if (selectedAnchorsRef.current.includes(anchorId)) {
          const activeSession = sessionsRef.current?.[anchorId];
          if (activeSession) {
            void ensureLiveSession(anchorId, activeSession).catch(() => undefined);
          }
        }
      });
    }, 120_000);
    heartbeatTimersRef.current.set(anchorId, timer);
  }

  function mergeRelayedSession(anchorId: AnchorId, session: AnchorSession) {
    setSessions((existingSessions) => {
      if (!existingSessions) {
        return existingSessions;
      }

      return {
        ...existingSessions,
        [anchorId]: session,
      };
    });
  }

  async function relayBrowserSessionEvent(anchorId: AnchorId, serverSessionId: string, event: BrowserSessionEvent) {
    try {
      const payload = await api.relaySessionEvent({
        anchorId,
        sessionId: serverSessionId,
        event,
      });

      if (payload.accepted) {
        mergeRelayedSession(anchorId, payload.session);
      }

      if (payload.session.status === "stopped" || payload.session.status === "idle") {
        clearLiveSessionRefs(anchorId);
      }

      return payload;
    } catch (error) {
      if (event.type !== "client.runtime_error") {
        console.warn("Failed to relay LiveAvatar session event", event.type, error);
        if (resolveVoiceInputAnchorId(sourceModeRef.current, selectedAnchorsRef.current) === anchorId) {
          setVoiceError(error instanceof Error ? error.message : "LiveAvatar event relay failed.");
          setVoiceCaptureState((existing) => (existing === "submitting" ? existing : "blocked"));
        }
        return null;
      }

      setSessions((existingSessions) => {
        if (!existingSessions) {
          return existingSessions;
        }

        return {
          ...existingSessions,
          [anchorId]: {
            ...existingSessions[anchorId],
            startupError: error instanceof Error ? error.message : "Failed to relay LiveAvatar session event.",
          },
        };
      });

      return null;
    }
  }

  function interruptSelectedPlayback(anchorIds: AnchorId[]) {
    for (const anchorId of anchorIds) {
      const browserSession = liveSessionsRef.current.get(anchorId);
      if (browserSession) {
        interruptSession(browserSession);
      }
    }
  }

  function shouldIgnoreVoiceHotkey(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
  }

  async function relayClientRuntimeError(
    anchorId: AnchorId,
    serverSessionId: string,
    phase: "start" | "stream_wait" | "playback" | "attach",
    message: string,
  ) {
    await relayBrowserSessionEvent(anchorId, serverSessionId, {
      type: "client.runtime_error",
      timestamp: new Date().toISOString(),
      phase,
      message,
    });
  }

  useEffect(() => {
    storyPacketRef.current = storyPacket;
  }, [storyPacket]);

  const hudPanelTurns = useMemo(
    () => conversationGroups.flatMap((g) => g.turns),
    [conversationGroups],
  );
  useHudBindings({ activeSpeaker, anchors, storyPacket, panelTurns: hudPanelTurns });

  // Latest fact-check per anchor, surfaced as a broadcast overlay on the
  // active AnchorCard. The sidebar continues to show the per-turn history;
  // this just promotes the most recent one onto the video for the pitch.
  const latestFactCheckByAnchor = useMemo(() => {
    const map: Partial<Record<AnchorId, FactCheckCardState>> = {};
    for (let i = hudPanelTurns.length - 1; i >= 0; i--) {
      const turn = hudPanelTurns[i];
      if (map[turn.anchorId]) continue;
      const fc = factChecks.get(turn.turnId);
      if (fc) map[turn.anchorId] = fc;
    }
    return map;
  }, [hudPanelTurns, factChecks]);

  // Rolling average confidence across the last 3 ready fact-checks. Feeds the
  // persistent "Live AI fact-check · NN%" chip in the HUD.
  const { confidenceAverage, confidenceSampleCount } = useMemo(() => {
    const samples: number[] = [];
    for (let i = hudPanelTurns.length - 1; i >= 0 && samples.length < 3; i--) {
      const state = factChecks.get(hudPanelTurns[i].turnId);
      if (state?.status !== "ready") continue;
      const c = state.result.confidence;
      if (c == null) continue;
      samples.push(c);
    }
    if (samples.length === 0) return { confidenceAverage: null, confidenceSampleCount: 0 };
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return { confidenceAverage: avg, confidenceSampleCount: samples.length };
  }, [hudPanelTurns, factChecks]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    sourceModeRef.current = sourceMode;
  }, [sourceMode]);

  useEffect(() => {
    selectedAnchorsRef.current = selectedAnchors;
  }, [selectedAnchors]);

  useEffect(() => {
    debateConfigRef.current = debateConfig;
  }, [debateConfig]);

  useEffect(() => {
    llmConfigRef.current = llmConfig;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(llmConfigStorageKey, JSON.stringify(llmConfig));
    } catch {
      // ignore storage errors (private mode, quota)
    }
  }, [llmConfig]);

  useEffect(() => {
    providerModeRef.current = providerMode;
  }, [providerMode]);

  useEffect(() => {
    if (
      debateConfig.openingSpeaker !== "auto" &&
      !selectedAnchors.includes(debateConfig.openingSpeaker)
    ) {
      setDebateConfig((existing) => ({
        ...existing,
        openingSpeaker: "auto",
      }));
    }
  }, [debateConfig.openingSpeaker, selectedAnchors]);

  useEffect(() => {
    voiceCaptureStateRef.current = voiceCaptureState;
  }, [voiceCaptureState]);

  useEffect(() => {
    if (activeSpeaker === null) {
      setLiveTimerSeconds(0);
      return;
    }
    setLiveTimerSeconds(0);
    const interval = window.setInterval(() => {
      setLiveTimerSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeSpeaker]);

  const previousTurnCountRef = useRef(0);
  useEffect(() => {
    const next = conversationGroups.length;
    if (next > 0 && previousTurnCountRef.current === 0) {
      setFeedOpen(true);
    }
    previousTurnCountRef.current = next;
  }, [conversationGroups.length]);

  useEffect(() => {
    async function loadBootstrap() {
      setLoading(true);
      setBootstrapError(null);

      try {
        const bootstrap = await api.bootstrap();
        const initialDemoStory =
          bootstrap.availableStories[0]?.id ??
          (bootstrap.storyPacket?.sourceType === "demo_story" ? bootstrap.storyPacket.id : "");

        setAnchors(bootstrap.anchors);
        setAnchorRuntimeStatus(bootstrap.anchorRuntimeStatus);
        setSessions(bootstrap.sessions);
        setSelectedAnchors(bootstrap.selectedAnchors);
        selectedAnchorsRef.current = bootstrap.selectedAnchors;
        setStories(bootstrap.availableStories);
        setStoryPacket(bootstrap.storyPacket);
        setProviderMode(bootstrap.providerMode);
        setSourceMode(bootstrap.sourceMode);
        sourceModeRef.current = bootstrap.sourceMode;
        setLiveFeedEnabled(bootstrap.liveFeedEnabled);
        setLiveFeedPollMs(bootstrap.liveFeedPollMs);
        setDemoStoryId(initialDemoStory);
        setArticleUrl(bootstrap.storyPacket?.sourceUrl ?? "");
        setViewerPrompt(getDefaultPrompt(bootstrap.sourceMode));
        setLiveStatus({
          ...bootstrap.liveStatus,
        });
      } catch (error) {
        setBootstrapError(error instanceof Error ? error.message : "Failed to load the election desk.");
      } finally {
        setLoading(false);
      }
    }

    void loadBootstrap().catch((error) => console.warn("[app] bootstrap load failed", error));
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of heartbeatTimersRef.current.values()) {
        clearInterval(timer);
      }
      heartbeatTimersRef.current.clear();
      for (const session of liveSessionsRef.current.values()) {
        void session.stop().catch(() => undefined);
      }
      liveSessionsRef.current.clear();
      liveSessionKeysRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      // Backgrounded tabs throttle setInterval; on return, ping every warm session
      // once immediately so we don't drift over the 5-minute platform cliff.
      for (const [anchorId, session] of liveSessionsRef.current.entries()) {
        session.keepAlive().catch((error) => {
          console.warn(`[liveavatar] visibility keep-alive failed for ${anchorId}`, error);
        });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const selectedProfiles = useMemo(
    () => anchors.filter((profile) => selectedAnchors.includes(profile.id)),
    [anchors, selectedAnchors],
  );
  const voiceInputAnchorId = useMemo(
    () => resolveVoiceInputAnchorId(sourceMode, selectedAnchors),
    [selectedAnchors, sourceMode],
  );
  const voiceInputAnchorProfile = useMemo(
    () => anchors.find((profile) => profile.id === voiceInputAnchorId) ?? null,
    [anchors, voiceInputAnchorId],
  );

  function registerMediaElement(anchorId: AnchorId, element: HTMLVideoElement | null) {
    mediaElementsRef.current[anchorId] = element;
    const liveSession = liveSessionsRef.current.get(anchorId);
    if (element && liveSession) {
      liveSession.attach(element);
      resumeMediaElement(element);
    }
  }

  async function stopLiveSession(anchorId: AnchorId) {
    stopHeartbeat(anchorId);
    const pending = pendingLiveSessionsRef.current.get(anchorId);
    if (pending) {
      pendingLiveSessionsRef.current.delete(anchorId);
    }

    const existing = liveSessionsRef.current.get(anchorId);
    if (existing) {
      await existing.stop().catch(() => undefined);
      liveSessionsRef.current.delete(anchorId);
    }

    liveSessionKeysRef.current.delete(anchorId);
  }

  async function stopNonActiveLiveSessions(exceptAnchorId?: AnchorId) {
    const activeAnchorIds = Array.from(liveSessionsRef.current.keys());
    for (const anchorId of activeAnchorIds) {
      if (anchorId === exceptAnchorId) {
        continue;
      }

      await stopLiveSession(anchorId);
    }
  }

  // Stop only browser-side RTC sessions whose anchor is no longer in the
  // selection. Keeps warm sessions alive for every selected anchor so that
  // speaker handoffs don't pay teardown + recreate cost.
  async function stopLiveSessionsForDeselected(allowed: ReadonlySet<AnchorId>) {
    const activeAnchorIds = Array.from(liveSessionsRef.current.keys());
    for (const anchorId of activeAnchorIds) {
      if (allowed.has(anchorId)) {
        continue;
      }
      await stopLiveSession(anchorId);
    }
  }

  function syncLocalSingleSessionState(activeAnchorId: AnchorId | null) {
    if (providerMode !== "full-api") {
      return;
    }

    setSessions((existingSessions) => {
      if (!existingSessions) {
        return existingSessions;
      }

      const nextSessions = { ...existingSessions };
      for (const [anchorId, session] of Object.entries(existingSessions) as [AnchorId, AnchorSession][]) {
        if (activeAnchorId && anchorId === activeAnchorId) {
          continue;
        }

        nextSessions[anchorId] = {
          ...session,
          status: session.isSelected ? "standby" : "idle",
          liveReady: false,
          startupError: undefined,
        };
      }

      return nextSessions;
    });
  }

  async function refreshAnchorSession(anchorId: AnchorId) {
    const payload = await api.refreshSession({ anchorId });
    setSessions(payload.sessions);
    return payload.sessions[anchorId] ?? payload.session;
  }

  function wireBrowserSessionEvents(
    anchorId: AnchorId,
    serverSessionId: string,
    browserSession: LiveAvatarSession,
  ) {
    browserSession.on(LiveSessionEvent.SESSION_STREAM_READY, () => {
      const nextElement = mediaElementsRef.current[anchorId];
      if (nextElement) {
        browserSession.attach(nextElement);
        resumeMediaElement(nextElement);
      }

      // Attach a per-turn MediaRecorder for the highlight reel pipeline (§4).
      // Replaces any prior recorder for this anchor (e.g. on session refresh).
      try {
        highlightRecordersRef.current[anchorId]?.dispose();
        highlightRecordersRef.current[anchorId] = attachHighlightRecorder(
          browserSession,
          highlightSessionIdRef.current,
        );
      } catch (err) {
        console.warn("[highlightRecorder] attach failed", err);
      }

      void relayBrowserSessionEvent(anchorId, serverSessionId, {
        type: "session.stream_ready",
        timestamp: new Date().toISOString(),
      });
    });

    browserSession.on(LiveSessionEvent.SESSION_DISCONNECTED, (reason) => {
      if (activeVoiceAnchorIdRef.current === anchorId) {
        setVoiceCaptureState((existing) => (existing === "submitting" ? existing : "idle"));
        // Intentionally preserve voiceDraftTranscript so an in-flight submission can resume.
        setCurrentVoiceAnchor(null);
      }

      void relayBrowserSessionEvent(anchorId, serverSessionId, {
        type: "session.disconnected",
        timestamp: new Date().toISOString(),
        reason: typeof reason === "string" && reason.length > 0 ? reason : "UNKNOWN_REASON",
      });
    });

    browserSession.on(AgentEventsEnum.SESSION_STOPPED, (event) => {
      if (activeVoiceAnchorIdRef.current === anchorId) {
        setVoiceCaptureState((existing) => (existing === "submitting" ? existing : "idle"));
        setCurrentVoiceAnchor(null);
      }

      void relayBrowserSessionEvent(anchorId, serverSessionId, {
        type: "session.stopped",
        timestamp: new Date().toISOString(),
        stopReason: event.stop_reason || "UNKNOWN_REASON",
        eventId: event.event_id || buildRelayEventId(),
        sourceEventId: event.source_event_id,
      });
    });

    browserSession.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (event) => {
      resumeMediaElement(mediaElementsRef.current[anchorId]);
      void relayBrowserSessionEvent(anchorId, serverSessionId, {
        type: "avatar.transcription",
        timestamp: new Date().toISOString(),
        eventId: event.event_id || buildRelayEventId(),
        sourceEventId: event.source_event_id,
        text: String(event.text ?? ""),
      });
    });

    browserSession.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, (event) => {
      resumeMediaElement(mediaElementsRef.current[anchorId]);
      void relayBrowserSessionEvent(anchorId, serverSessionId, {
        type: "avatar.speak_started",
        timestamp: new Date().toISOString(),
        eventId: event.event_id || buildRelayEventId(),
        sourceEventId: event.source_event_id,
      });
    });

    browserSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, (event) => {
      void relayBrowserSessionEvent(anchorId, serverSessionId, {
        type: "avatar.speak_ended",
        timestamp: new Date().toISOString(),
        eventId: event.event_id || buildRelayEventId(),
        sourceEventId: event.source_event_id,
      });
      // Stop and upload the per-turn clip in the background.
      void highlightRecordersRef.current[anchorId]?.stopTurn();
    });

    browserSession.on(AgentEventsEnum.USER_SPEAK_STARTED, () => {
      const activeVoiceTurn = voiceTurnRef.current;
      if (activeVoiceAnchorIdRef.current !== anchorId || !activeVoiceTurn || activeVoiceTurn.anchorId !== anchorId) {
        return;
      }

      setVoiceCaptureState("listening");
      setVoiceDraftTranscript("");
      voiceTranscriptRef.current = null;
      voicePartialTranscriptRef.current = "";
      voiceSubmitGuardRef.current = null;
      setVoiceError(null);
      syncQuestion(activeVoiceTurn.questionId, { status: "recording" });
    });

    browserSession.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, (event) => {
      const activeVoiceTurn = voiceTurnRef.current;
      if (activeVoiceAnchorIdRef.current !== anchorId || !activeVoiceTurn || activeVoiceTurn.anchorId !== anchorId) {
        return;
      }

      voicePartialTranscriptRef.current = event.text;
      setVoiceCaptureState(activeVoiceTurn.released ? "transcribing" : "listening");
      setVoiceDraftTranscript(event.text);
      syncQuestion(activeVoiceTurn.questionId, {
        text: event.text,
        status: activeVoiceTurn.released ? "transcribing" : "recording",
      });
    });

    browserSession.on(AgentEventsEnum.USER_TRANSCRIPTION, (event) => {
      const activeVoiceTurn = voiceTurnRef.current;
      if (activeVoiceAnchorIdRef.current !== anchorId || !activeVoiceTurn || activeVoiceTurn.anchorId !== anchorId) {
        return;
      }

      setVoiceCaptureState((existing) =>
        existing === "submitting" ? existing : activeVoiceTurn.released ? "transcribing" : "listening",
      );
      setVoiceDraftTranscript(event.text);
      voiceTranscriptRef.current = event.text;
      syncQuestion(activeVoiceTurn.questionId, {
        text: event.text,
        status: activeVoiceTurn.released ? "transcribing" : "recording",
      });

      if (activeVoiceTurn.released) {
        void finalizeReleasedVoiceQuestion();
      }
    });

    browserSession.on(AgentEventsEnum.USER_SPEAK_ENDED, () => {
      const activeVoiceTurn = voiceTurnRef.current;
      if (activeVoiceAnchorIdRef.current !== anchorId || !activeVoiceTurn || activeVoiceTurn.anchorId !== anchorId) {
        return;
      }

      if (activeVoiceTurn.released) {
        void finalizeReleasedVoiceQuestion();
      }
    });

    browserSession.voiceChat.on(VoiceChatEvent.STATE_CHANGED, () => {
      // Voice capture state is driven by the browser speech events above; keep this hook for SDK visibility.
    });
  }

  async function ensureLiveSession(
    anchorId: AnchorId,
    session: AnchorSession | undefined,
  ) {
    if (providerModeRef.current !== "full-api") {
      return null;
    }

    // Drop only sessions for anchors no longer selected — keep warm sessions
    // for every still-selected anchor so the speaker handoff is instant.
    await stopLiveSessionsForDeselected(new Set(selectedAnchorsRef.current));

    let activeSession = session ?? sessionsRef.current?.[anchorId];
    if (!activeSession) {
      return null;
    }

    const desiredKey = activeSession.sessionAccessToken ? buildLiveSessionKey(activeSession) : null;
    const existing = liveSessionsRef.current.get(anchorId);
    const existingKey = liveSessionKeysRef.current.get(anchorId);
    // "standby" is the normal idle state for selected non-speaking anchors in full-api
    // mode (set whenever a peer's avatar.speak_started fires). Reusing the warm browser
    // session in standby is the whole point of prewarming — don't tear it down on every
    // handoff, which was the cause of silent-speaker bugs where planned comments never
    // played because the session got rebuilt mid-turn and timed out.
    if (
      existing &&
      desiredKey &&
      existingKey === desiredKey &&
      activeSession.status !== "idle" &&
      activeSession.status !== "stopped"
    ) {
      const element = mediaElementsRef.current[anchorId];
      if (element) {
        existing.attach(element);
      }
      syncLocalSingleSessionState(anchorId);
      return existing;
    }

    if (existing && existingKey !== desiredKey) {
      await stopLiveSession(anchorId);
    }

    if (
      !activeSession.sessionAccessToken ||
      activeSession.status === "idle" ||
      activeSession.status === "stopped" ||
      activeSession.startupError === "SERVER_INITIATED" ||
      activeSession.startupError === "SESSION_START_FAILED"
    ) {
      activeSession = await refreshAnchorSession(anchorId);
    }

    if (!activeSession.sessionAccessToken) {
      return null;
    }

    const pending = pendingLiveSessionsRef.current.get(anchorId);
    if (pending) {
      return pending;
    }

    const sessionForStart = activeSession;
    const startPromise = (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const browserSession = await createBrowserLiveSession(
            sessionForStart.sessionAccessToken!,
            undefined,
            (nextSession) => {
              wireBrowserSessionEvents(anchorId, sessionForStart.sessionId, nextSession);

              const element = mediaElementsRef.current[anchorId];
              if (element) {
                nextSession.attach(element);
                resumeMediaElement(element);
              }
            },
          );

          try {
            await waitForStreamReady(browserSession, 10000);
            liveSessionsRef.current.set(anchorId, browserSession);
            liveSessionKeysRef.current.set(anchorId, buildLiveSessionKey(activeSession));
            startHeartbeat(anchorId, browserSession);
            setSessions((existingSessions) => {
              if (!existingSessions) {
                return existingSessions;
              }

              return {
                ...existingSessions,
                [anchorId]: {
                  ...existingSessions[anchorId],
                  liveReady: true,
                  startupError: undefined,
                },
              };
            });
            syncLocalSingleSessionState(anchorId);

            return browserSession;
          } catch (streamError) {
            await browserSession.stop().catch(() => undefined);
            if (attempt === 1) {
              throw streamError;
            }

            activeSession = await refreshAnchorSession(anchorId);
          }
        }

        return null;
      } catch (error) {
        setSessions((existingSessions) => {
          if (!existingSessions) {
            return existingSessions;
          }

          return {
            ...existingSessions,
            [anchorId]: {
              ...existingSessions[anchorId],
              liveReady: false,
              startupError: error instanceof Error ? error.message : "LiveAvatar session failed to start",
            },
          };
        });
        return null;
      } finally {
        pendingLiveSessionsRef.current.delete(anchorId);
      }
    })();

    pendingLiveSessionsRef.current.set(anchorId, startPromise);
    return startPromise;
  }

  async function prepareStageStarter() {
    if (providerMode !== "full-api" || sourceModeRef.current === "demo_story") {
      return;
    }

    const activeSessions = sessionsRef.current;
    if (!activeSessions) {
      return;
    }

    const selected = selectedAnchorsRef.current;
    const starterAnchorId = getStageStarterAnchorId(selected, debateConfigRef.current.openingSpeaker);
    setConnectingFeeds(true);
    try {
      // Pre-warm a browser session for every selected anchor in parallel so
      // each is RTC-ready in standby; speaker handoffs become a no-op at the
      // connection layer.
      await Promise.all(
        selected.map((anchorId) => ensureLiveSession(anchorId, activeSessions[anchorId])),
      );
      resumeMediaElement(mediaElementsRef.current[starterAnchorId]);
    } finally {
      setConnectingFeeds(false);
    }
  }

  function prewarmSelectedLiveSessions() {
    if (providerMode !== "full-api" || sourceMode === "demo_story") return;
    const activeSessions = sessionsRef.current;
    if (!activeSessions) return;
    for (const anchorId of selectedAnchorsRef.current) {
      if (liveSessionsRef.current.has(anchorId) || pendingLiveSessionsRef.current.has(anchorId)) {
        continue;
      }
      const session = activeSessions[anchorId];
      if (!session) continue;
      void ensureLiveSession(anchorId, session).catch(() => undefined);
    }
  }

  async function syncSelection(nextSelection: AnchorId[]) {
    if (providerMode === "full-api" && sourceMode !== "demo_story") {
      interruptCurrentResponse(selectedAnchorsRef.current, "syncSelection");
      await stopLiveSessionsForDeselected(new Set(nextSelection));
      syncLocalSingleSessionState(null);
    }

    setSelectedAnchors(nextSelection);
    selectedAnchorsRef.current = nextSelection;
    const payload = await api.syncSessions({ selectedAnchors: nextSelection });
    setSelectedAnchors(payload.selectedAnchors);
    selectedAnchorsRef.current = payload.selectedAnchors;
    setSessions(payload.sessions);
  }

  const refreshLivePacket = useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (!liveFeedEnabled) {
        return;
      }

      const showLoading = options?.showLoading ?? true;
      const pending = liveRefreshInFlightRef.current;
      if (pending) {
        return pending;
      }

      const request = (async () => {
        if (showLoading) {
          setLoadingLivePacket(true);
        }

        try {
          const payload = await api.liveCurrent();
          setLiveStatus(payload);

          if (payload.storyPacket) {
            const previousLiveStoryId =
              storyPacketRef.current?.sourceType === "live_feed" ? storyPacketRef.current.story_id : null;
            setStoryPacket(payload.storyPacket);

            if (sourceModeRef.current === "live_feed" && previousLiveStoryId !== payload.storyPacket.story_id) {
              resetPanelState();
            }
          }
        } catch (error) {
          setLiveStatus((existing) => ({
            ...existing,
            upstreamAvailable: false,
            errorMessage: error instanceof Error ? error.message : "Live feed refresh failed.",
          }));
        } finally {
          if (showLoading) {
            setLoadingLivePacket(false);
          }
          liveRefreshInFlightRef.current = null;
        }
      })();

      liveRefreshInFlightRef.current = request;
      return request;
    },
    [liveFeedEnabled],
  );

  async function handleToggleAnchor(anchorId: AnchorId) {
    const nextSelection = toggleAnchor(selectedAnchors, anchorId);
    await syncSelection(nextSelection);
  }

  function handleDebateToneChange(nextTone: DebateConfig["tone"]) {
    setDebateConfig((existing) => ({
      ...existing,
      tone: nextTone,
    }));
  }

  function handleOpeningSpeakerChange(nextOpeningSpeaker: DebateOpeningSpeaker) {
    setDebateConfig((existing) => ({
      ...existing,
      openingSpeaker: nextOpeningSpeaker,
    }));
  }

  function handleDebateRoundsChange(nextRounds: DebateConfig["debateRounds"]) {
    setDebateConfig((existing) => ({ ...existing, debateRounds: nextRounds }));
  }

  function handleModeratorBeatChange(next: boolean) {
    setDebateConfig((existing) => ({ ...existing, includeModeratorBeat: next }));
  }

  async function handleInterruptTurn() {
    if (!busy && !activeSpeaker) {
      return;
    }

    interruptCurrentResponse(selectedAnchorsRef.current, "handleInterruptTurn");
    await stopNonActiveLiveSessions();
    syncLocalSingleSessionState(null);
    setBusy(false);
  }

  async function handleSelectStory(storyId: string) {
    const payload = await api.selectStory({ storyId });
    sourceModeRef.current = "demo_story";
    setSourceMode("demo_story");
    setDemoStoryId(storyId);
    setStoryPacket(payload.storyPacket);
    setArticleError(null);
    resetVoiceState();
    setViewerPrompt(defaultPanelPrompt);
    resetPanelState();
  }

  function runFactCheck(turn: PanelTurn, story: StoryPacket | null) {
    if (!story) return;
    setFactChecks((existing) => {
      const next = new Map(existing);
      next.set(turn.turnId, { status: "loading" });
      return next;
    });
    let articleContext: FactCheckArticleContext | undefined;
    if (story.sourceType === "article") {
      const lensFraming =
        turn.anchorId === "left"
          ? story.left_framing_summary
          : turn.anchorId === "right"
            ? story.right_framing_summary
            : undefined;
      const body = story.articleBody ?? "";
      articleContext = {
        sourceUrl: story.sourceUrl,
        sourceTitle: story.sourceTitle,
        sourceDomain: story.sourceDomain,
        neutralSummary: story.neutral_summary,
        lensFraming,
        articleExcerpt: body.length > 2000 ? `${body.slice(0, 2000).trimEnd()}...` : body || undefined,
      };
    }
    api
      .factCheck({
        turnId: turn.turnId,
        transcript: turn.transcript,
        storyTitle: story.title,
        storyTopic: story.topic,
        anchorLean: turn.anchorId,
        articleContext,
      })
      .then((result) => {
        setFactChecks((existing) => {
          const next = new Map(existing);
          next.set(turn.turnId, { status: "ready", result });
          return next;
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[factcheck] turn ${turn.turnId} failed: ${message}`);
        setFactChecks((existing) => {
          const next = new Map(existing);
          next.set(turn.turnId, { status: "error", message });
          return next;
        });
      });
  }

  async function playPanelResponse(
    stream: AsyncIterable<OrchestrateStreamFrame>,
    prompt: string,
    options: {
      sourceMode?: SourceType;
      questionId: string;
      responseId: number;
    },
  ) {
    const questionId = options.questionId;
    const responseId = options.responseId;
    if (responseId !== activeResponseIdRef.current) {
      return;
    }

    setViewerPrompt(prompt);

    const pendingTurns: PanelTurn[] = [];
    let streamSessions: Record<AnchorId, AnchorSession> | null = null;
    let streamStoryPacket: StoryPacket | null = null;
    let streamDone = false;
    let streamError: string | null = null;
    let pendingResolve: (() => void) | null = null;

    function notifyPending() {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve?.();
    }

    function waitForNext(): Promise<void> {
      return new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }

    const consumer = (async () => {
      try {
        for await (const frame of stream) {
          if (responseId !== activeResponseIdRef.current) {
            break;
          }
          if (frame.type === "session") {
            streamSessions = frame.sessions;
            streamStoryPacket = frame.storyPacket;
            setStoryPacket(frame.storyPacket);
            setSessions(frame.sessions);
            setSelectedAnchors(frame.selectedAnchors);
            selectedAnchorsRef.current = frame.selectedAnchors;
          } else if (frame.type === "turn") {
            pendingTurns.push(frame.turn);
            notifyPending();
          } else if (frame.type === "error") {
            streamError = frame.message;
            notifyPending();
            break;
          }
        }
      } catch (error) {
        streamError = error instanceof Error ? error.message : "Stream failed.";
      } finally {
        streamDone = true;
        notifyPending();
      }
    })();

    try {
      while (true) {
        if (responseId !== activeResponseIdRef.current) {
          break;
        }
        if (pendingTurns.length === 0) {
          if (streamDone) break;
          await waitForNext();
          continue;
        }

        const turn = pendingTurns.shift()!;
        const nextTurn = pendingTurns[0];
        const turnSessions: Partial<Record<AnchorId, AnchorSession>> = streamSessions ?? {};
        const turnStoryPacket = streamStoryPacket;

        setActiveSpeaker(turn.anchorId);
        setActiveTurnContext({
          replyToAnchorId: turn.replyToAnchorId,
          roundIndex: turn.roundIndex,
          isModeratorBeat: turn.isModeratorBeat,
        });
        appendConversationTurn(questionId, turn);
        // Begin recording this turn's avatar feed for the highlight reel.
        try {
          highlightRecordersRef.current[turn.anchorId]?.startTurn(turn.turnId);
        } catch (err) {
          console.warn("[highlightRecorder] startTurn failed", err);
        }
        // Server-side fact-check is embedded on the turn frame (run in parallel with
        // TTS playback by the orchestrator). Render it directly so a peer cite or
        // contradict from the same response uses the same evidence we surface in UI.
        // Fall back to the client-side /api/factcheck call only when the server didn't
        // attach a grounded result (e.g. GEMINI_API_KEY unset or fact-check threw).
        if (turn.factCheck && turn.factCheck.mode === "grounded") {
          setFactChecks((existing) => {
            const next = new Map(existing);
            next.set(turn.turnId, { status: "ready", result: turn.factCheck! });
            return next;
          });
        } else if (turnStoryPacket) {
          void runFactCheck(turn, turnStoryPacket);
        }
        const mutateLocalSessionState = providerMode !== "full-api";
        if (mutateLocalSessionState) {
          setSessions((existingSessions) => {
            if (!existingSessions) {
              return existingSessions;
            }

            return {
              ...existingSessions,
              [turn.anchorId]: {
                ...existingSessions[turn.anchorId],
                transcript: turn.transcript,
                status: "speaking",
              },
            };
          });
        }

        const liveSession = await ensureLiveSession(turn.anchorId, turnSessions[turn.anchorId]);
        if (liveSession) {
          let playbackResult = await repeatAndWait(liveSession, turn.transcript);
          if (providerMode === "full-api" && playbackResult.outcome !== "ended") {
            console.warn(
              `[liveavatar] playback non-ended outcome=${playbackResult.outcome} anchorId=${turn.anchorId} elapsedMs=${playbackResult.elapsedMs} commandEventId=${playbackResult.commandEventId ?? "(none)"} transcriptLen=${turn.transcript.length} message=${playbackResult.message ?? ""}`,
            );

            if (responseId === activeResponseIdRef.current) {
              console.warn(`[liveavatar] retrying playback anchorId=${turn.anchorId}`);
              await stopLiveSession(turn.anchorId);
              const retrySession = await ensureLiveSession(turn.anchorId, turnSessions[turn.anchorId]);
              if (retrySession && responseId === activeResponseIdRef.current) {
                playbackResult = await repeatAndWait(retrySession, turn.transcript);
                if (playbackResult.outcome !== "ended") {
                  console.warn(
                    `[liveavatar] retry also failed outcome=${playbackResult.outcome} anchorId=${turn.anchorId} elapsedMs=${playbackResult.elapsedMs}`,
                  );
                }
              }
            }

            if (playbackResult.outcome !== "ended") {
              const sessionId = liveSessionKeysRef.current.get(turn.anchorId) ?? turnSessions[turn.anchorId]?.sessionId ?? "";
              void relayClientRuntimeError(
                turn.anchorId,
                sessionId,
                "playback",
                playbackResult.message ?? `Could not play this turn — avatar playback ${playbackResult.outcome}.`,
              );
            }
          }

          if (
            nextTurn &&
            nextTurn.anchorId !== turn.anchorId &&
            responseId === activeResponseIdRef.current
          ) {
            void ensureLiveSession(nextTurn.anchorId, turnSessions[nextTurn.anchorId]).catch(() => undefined);
          }
        } else {
          // No live session for this anchor — the orchestrator turn would
          // otherwise be silently swallowed and the anchor would just sit on
          // standby. Surface a one-line reason on the card so the user knows.
          if (providerMode === "full-api") {
            const sessionId = liveSessionKeysRef.current.get(turn.anchorId) ?? turnSessions[turn.anchorId]?.sessionId ?? "";
            void relayClientRuntimeError(
              turn.anchorId,
              sessionId,
              "start",
              "Could not start avatar session for this anchor.",
            );
          }
          await delay(playbackDelayMs);
        }

        if (responseId !== activeResponseIdRef.current) {
          break;
        }

        if (mutateLocalSessionState) {
          setSessions((existingSessions) => {
            if (!existingSessions) {
              return existingSessions;
            }

            return {
              ...existingSessions,
              [turn.anchorId]: {
                ...existingSessions[turn.anchorId],
                status: "ready",
              },
            };
          });
        }
      }
    } finally {
      await consumer.catch(() => undefined);
    }

    if (streamError) {
      throw new Error(streamError);
    }

    if (responseId === activeResponseIdRef.current) {
      syncQuestion(questionId, { status: "done" });
      if (activeQuestionRef.current?.id === questionId) {
        setCurrentQuestion(null);
      }
      setActiveSpeaker(null);
      setActiveTurnContext(null);
    }
  }

  async function finalizeReleasedVoiceQuestion() {
    const activeVoiceTurn = voiceTurnRef.current;
    if (!activeVoiceTurn || !activeVoiceTurn.released || activeVoiceTurn.submitted) {
      return false;
    }

    const transcript = voiceTranscriptRef.current?.trim() || voicePartialTranscriptRef.current.trim();
    if (!transcript) {
      return false;
    }

    activeVoiceTurn.submitted = true;
    clearVoiceReleaseTimeout();
    setCurrentVoiceAnchor(null);
    syncQuestion(activeVoiceTurn.questionId, {
      text: transcript,
      status: "answering",
    });

    void submitVoiceTranscript(activeVoiceTurn.anchorId, activeVoiceTurn.sessionId, transcript, {
      questionId: activeVoiceTurn.questionId,
      responseId: activeVoiceTurn.responseId,
    }).catch((error) => console.warn("[app] submitVoiceTranscript failed", error));
    return true;
  }

  async function submitVoiceTranscript(
    anchorId: AnchorId,
    sessionId: string,
    transcript: string,
    options: {
      questionId: string;
      responseId: number;
    },
  ) {
    const trimmedTranscript = transcript.trim();
    if (!trimmedTranscript || voiceSubmitGuardRef.current === trimmedTranscript || sourceModeRef.current === "demo_story") {
      return;
    }

    const activeSourceMode = sourceModeRef.current;
    const activeSelectedAnchors = selectedAnchorsRef.current;
    const question: ConversationPrompt = {
      id: options.questionId,
      text: trimmedTranscript,
      source: "voice",
      status: "answering",
    };

    setCurrentQuestion(question);
    upsertConversationGroup(question);
    voiceSubmitGuardRef.current = trimmedTranscript;
    setBusy(true);
    setVoiceCaptureState("submitting");
    setVoiceDraftTranscript(trimmedTranscript);

    try {
      const stream = api.voiceTurnStream({
        sourceMode: activeSourceMode === "article" ? "article" : "live_feed",
        transcript: trimmedTranscript,
        selectedAnchors: activeSelectedAnchors,
        debateConfig: debateConfigRef.current,
        sessionTranscript: buildSessionTranscript(conversationGroups),
        llm: llmConfigRef.current,
      });
      await playPanelResponse(stream, trimmedTranscript, {
        sourceMode: activeSourceMode,
        questionId: options.questionId,
        responseId: options.responseId,
      });
      setVoiceError(null);
    } catch (error) {
      syncQuestion(options.questionId, { status: "failed" });
      if (activeQuestionRef.current?.id === options.questionId) {
        setCurrentQuestion(null);
      }
      setVoiceError(error instanceof Error ? error.message : "Voice turn failed.");
      await relayClientRuntimeError(anchorId, sessionId, "playback", error instanceof Error ? error.message : "Voice turn failed.");
    } finally {
      if (voiceTurnRef.current?.questionId === options.questionId) {
        voiceTurnRef.current = null;
      }
      voiceTranscriptRef.current = null;
      voicePartialTranscriptRef.current = "";
      voiceSubmitGuardRef.current = null;
      setCurrentVoiceAnchor(null);
      setVoiceCaptureState("idle");
      setBusy(false);
    }
  }

  const handleVoiceStart = useCallback(async () => {
    if (voiceStartInFlightRef.current || isVoiceCaptureActive(voiceCaptureStateRef.current)) {
      return;
    }

    voicePointerHeldRef.current = true;
    voiceStartInFlightRef.current = true;

    const activeSourceMode = sourceModeRef.current;
    const activeSelectedAnchors = selectedAnchorsRef.current;
    if (activeSourceMode === "demo_story" || providerModeRef.current !== "full-api") {
      voicePointerHeldRef.current = false;
      voiceStartInFlightRef.current = false;
      return;
    }

    const listeningAnchorId = resolveVoiceInputAnchorId(activeSourceMode, activeSelectedAnchors);
    if (!listeningAnchorId) {
      setVoiceError("Select an anchor before starting voice input.");
      setVoiceCaptureState("blocked");
      setCurrentVoiceAnchor(null);
      voicePointerHeldRef.current = false;
      voiceStartInFlightRef.current = false;
      return;
    }

    const session = sessionsRef.current?.[listeningAnchorId];
    if (!session) {
      setVoiceError("Voice input session is still loading.");
      setVoiceCaptureState("blocked");
      setCurrentVoiceAnchor(null);
      voicePointerHeldRef.current = false;
      voiceStartInFlightRef.current = false;
      return;
    }

    setVoiceError(null);
    setVoiceCaptureState("preparing");
    setVoiceDraftTranscript("");
    voiceTranscriptRef.current = null;
    voicePartialTranscriptRef.current = "";
    voiceSubmitGuardRef.current = null;
    clearVoiceReleaseTimeout();

    const responseId = interruptCurrentResponse(activeSelectedAnchors, "voiceRecordingStart");
    const question = beginQuestion("", "voice", "recording");
    setCurrentVoiceAnchor(listeningAnchorId);
    voiceTurnRef.current = {
      questionId: question.id,
      responseId,
      anchorId: listeningAnchorId,
      sessionId: session.sessionId,
      released: false,
      submitted: false,
    };

    const liveSession = await ensureLiveSession(listeningAnchorId, session);
    if (!liveSession) {
      setVoiceCaptureState("blocked");
      setVoiceError("Could not start the listening anchor session.");
      setCurrentQuestion(null);
      voiceTurnRef.current = null;
      setCurrentVoiceAnchor(null);
      voicePointerHeldRef.current = false;
      voiceStartInFlightRef.current = false;
      return;
    }

    if (!voicePointerHeldRef.current) {
      setVoiceCaptureState("idle");
      setCurrentQuestion(null);
      voiceTurnRef.current = null;
      setCurrentVoiceAnchor(null);
      voiceStartInFlightRef.current = false;
      return;
    }

    try {
      await startVoiceCapture(liveSession);
      setVoiceCaptureState("listening");
      if (!voicePointerHeldRef.current) {
        await stopVoiceCapture(liveSession).catch(() => undefined);
        setVoiceCaptureState("idle");
        setCurrentVoiceAnchor(null);
      }
    } catch (error) {
      setVoiceCaptureState("blocked");
      setVoiceError(error instanceof Error ? error.message : "Failed to start voice capture.");
      setCurrentQuestion(null);
      voiceTurnRef.current = null;
      setCurrentVoiceAnchor(null);
      voicePointerHeldRef.current = false;
    } finally {
      voiceStartInFlightRef.current = false;
    }
  }, []);

  const handleVoiceStop = useCallback(async () => {
    voicePointerHeldRef.current = false;

    const activeVoiceTurn = voiceTurnRef.current;
    if (voiceCaptureStateRef.current === "preparing") {
      setVoiceCaptureState("idle");
      if (activeVoiceTurn) {
        setCurrentQuestion(null);
        voiceTurnRef.current = null;
      }
    }

    if (sourceModeRef.current === "demo_story") {
      return;
    }

    const listeningAnchorId = activeVoiceAnchorIdRef.current;
    if (!listeningAnchorId) {
      setVoiceCaptureState("idle");
      return;
    }

    const liveSession = liveSessionsRef.current.get(listeningAnchorId);
    if (!liveSession) {
      setVoiceCaptureState("idle");
      setCurrentVoiceAnchor(null);
      return;
    }

    try {
      await stopVoiceCapture(liveSession);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Failed to stop voice capture.");
    }

    if (!activeVoiceTurn || activeVoiceTurn.anchorId !== listeningAnchorId) {
      return;
    }

    activeVoiceTurn.released = true;
    setVoiceCaptureState((existing) => (existing === "submitting" ? existing : "transcribing"));
    syncQuestion(activeVoiceTurn.questionId, { status: "transcribing" });

    if (await finalizeReleasedVoiceQuestion()) {
      return;
    }

    clearVoiceReleaseTimeout();
    voiceReleaseTimeoutRef.current = window.setTimeout(() => {
      void finalizeReleasedVoiceQuestion().then((submitted) => {
        if (submitted) {
          return;
        }

        const currentVoiceTurn = voiceTurnRef.current;
        if (!currentVoiceTurn || currentVoiceTurn.questionId !== activeVoiceTurn.questionId) {
          return;
        }

        syncQuestion(currentVoiceTurn.questionId, { status: "failed" });
        if (activeQuestionRef.current?.id === currentVoiceTurn.questionId) {
          setCurrentQuestion(null);
        }
        voiceTurnRef.current = null;
        setCurrentVoiceAnchor(null);
        setVoiceCaptureState("idle");
        setVoiceError("Could not hear a question. Try again.");
      });
    }, voiceReleaseGraceMs);
  }, []);

  async function handleSourceModeChange(nextMode: SourceType) {
    if (nextMode === sourceMode) {
      return;
    }

    if (nextMode === "live_feed" && !liveFeedEnabled) {
      return;
    }

    interruptCurrentResponse(selectedAnchorsRef.current, "sourceModeChange");
    if (providerMode === "full-api") {
      await stopNonActiveLiveSessions();
      syncLocalSingleSessionState(null);
    }

    setArticleError(null);
    resetVoiceState();
    clearPanelState();
    setBusy(false);

    const payload = await api.selectMode({ sourceMode: nextMode });
    sourceModeRef.current = payload.sourceMode;
    setSourceMode(payload.sourceMode);
    setSelectedAnchors(payload.selectedAnchors);
    selectedAnchorsRef.current = payload.selectedAnchors;
    setSessions(payload.sessions);
    setStoryPacket(payload.storyPacket);
    setViewerPrompt(getDefaultPrompt(payload.sourceMode));
    setLiveStatus(payload.liveStatus);
    if (payload.storyPacket?.sourceType === "demo_story") {
      setDemoStoryId(payload.storyPacket.id);
    }
    setArticleUrl((existing) =>
      payload.storyPacket?.sourceType === "article" ? payload.storyPacket.sourceUrl ?? existing : payload.sourceMode === "article" ? existing : existing,
    );
  }

  async function handleLoadArticle() {
    const trimmedUrl = articleUrl.trim();
    if (!trimmedUrl) {
      setArticleError("Enter a public article URL.");
      return;
    }

    setLoadingArticle(true);
    setArticleError(null);
    interruptCurrentResponse(selectedAnchorsRef.current, "handleLoadArticle");
    if (providerMode === "full-api") {
      await stopNonActiveLiveSessions();
      syncLocalSingleSessionState(null);
    }
    resetVoiceState();
    clearPanelState();
    setBusy(false);

    try {
      const payload = await api.loadArticle({ url: trimmedUrl });
      const nextSourceMode: SourceType = "article";
      sourceModeRef.current = nextSourceMode;
      setSourceMode("article");
      setSelectedAnchors(payload.selectedAnchors);
      selectedAnchorsRef.current = payload.selectedAnchors;
      setSessions(payload.sessions);
      setStoryPacket(payload.storyPacket);
      setArticleUrl(payload.storyPacket.sourceUrl ?? trimmedUrl);
      setViewerPrompt(defaultArticlePrompt);
    } catch (error) {
      setArticleError(error instanceof Error ? error.message : "Article loading failed.");
    } finally {
      setLoadingArticle(false);
    }
  }

  async function handleRunPrompt(prompt: string) {
    const nextPrompt = prompt.trim() || getDefaultPrompt(sourceMode);
    if (!storyPacket) {
      return;
    }

    if (sourceMode === "article" && storyPacket.sourceType !== "article") {
      setArticleError("Load a public article before asking the neutral anchor to discuss it.");
      return;
    }

    if (sourceMode === "live_feed" && storyPacket.sourceType !== "live_feed") {
      setLiveStatus((existing) => ({
        ...existing,
        errorMessage: "No live packet is available yet. Wait for the live feed to load or switch to demo mode.",
      }));
      return;
    }

    const responseId = interruptCurrentResponse(selectedAnchorsRef.current, "handleRunPrompt");
    const question = beginQuestion(nextPrompt, "typed", "answering", {
      addToFeed: true,
    });
    setBusy(true);
    setArticleError(null);
    setVoiceError(null);

    const sessionTranscript = buildSessionTranscript(conversationGroups);

    try {
      const stream =
        sourceMode === "article"
          ? api.askArticleStream({
              question: nextPrompt,
              selectedAnchors,
              debateConfig,
              sessionTranscript,
              llm: llmConfig,
            })
          : api.orchestrateStream({
              selectedAnchors,
              viewerPrompt: nextPrompt,
              debateConfig,
              sessionTranscript,
              llm: llmConfig,
              ...(sourceMode === "demo_story" ? { storyId: storyPacket.id } : {}),
            });

      await playPanelResponse(stream, nextPrompt, {
        sourceMode: sourceModeRef.current,
        questionId: question.id,
        responseId,
      });
    } catch (error) {
      syncQuestion(question.id, { status: "failed" });
      if (activeQuestionRef.current?.id === question.id) {
        setCurrentQuestion(null);
      }
      if (sourceMode === "article") {
        setArticleError(error instanceof Error ? error.message : "Article prompt failed.");
      } else if (sourceMode === "live_feed") {
        setLiveStatus((existing) => ({
          ...existing,
          errorMessage: error instanceof Error ? error.message : "Live panel prompt failed.",
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (sourceMode !== "demo_story") {
      return;
    }

    resetVoiceState();
  }, [sourceMode]);

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      const keyboardVoiceAvailable =
        providerMode === "full-api" &&
        sourceMode !== "demo_story" &&
        Boolean(voiceInputAnchorId);

      if (
        event.repeat ||
        event.key.toLowerCase() !== "z" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        shouldIgnoreVoiceHotkey(event.target) ||
        !keyboardVoiceAvailable
      ) {
        return;
      }

      if (voiceHotkeyHeldRef.current) {
        return;
      }

      voiceHotkeyHeldRef.current = true;
      event.preventDefault();
      void handleVoiceStart().catch((error) => console.warn("[app] voice start failed", error));
    }

    function handleWindowKeyUp(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || !voiceHotkeyHeldRef.current) {
        return;
      }

      voiceHotkeyHeldRef.current = false;
      event.preventDefault();
      void handleVoiceStop().catch((error) => console.warn("[app] voice stop failed", error));
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
    };
  }, [handleVoiceStart, handleVoiceStop, providerMode, sourceMode, voiceInputAnchorId]);

  useEffect(() => {
    if (!liveFeedEnabled || sourceMode !== "live_feed") {
      return;
    }

    void refreshLivePacket()?.catch((error) => console.warn("[app] live packet refresh failed", error));
    const intervalId = window.setInterval(() => {
      void refreshLivePacket({ showLoading: false })?.catch((error) =>
        console.warn("[app] live packet poll failed", error),
      );
    }, liveFeedPollMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [liveFeedEnabled, liveFeedPollMs, sourceMode, refreshLivePacket]);

  if (loading) {
    return <main className="shell loading-shell">Loading election desk...</main>;
  }
  if (bootstrapError || !sessions) {
    return (
      <main className="shell loading-shell">
        <section className="story-summary-card">
          <div className="story-summary-header">
            <div>
              <p className="eyebrow">Startup error</p>
              <h2>Could not load the election desk</h2>
            </div>
          </div>
          <p className="story-summary-line">{bootstrapError ?? "The session state could not be restored."}</p>
          <div className="control-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                window.location.reload();
              }}
            >
              Retry
            </button>
          </div>
        </section>
      </main>
    );
  }
  const voiceCandidateSession = voiceInputAnchorId ? sessions[voiceInputAnchorId] : null;
  const voiceAvailable =
    providerMode === "full-api" &&
    sourceMode !== "demo_story" &&
    Boolean(voiceInputAnchorId);
  const voiceBlockedReason =
    providerMode !== "full-api"
      ? "Voice chat requires the live LiveAvatar provider."
      : sourceMode === "demo_story"
        ? "Voice chat is disabled in demo mode."
        : !voiceInputAnchorId
          ? "Select a listening anchor before using voice chat."
          : voiceCandidateSession?.startupError
            ? voiceCandidateSession.startupError
            : null;
  const voiceAnchorLabel = voiceInputAnchorProfile?.label ?? voiceInputAnchorId ?? undefined;

  const currentTitle =
    sourceMode === "article"
      ? "Article Desk"
      : sourceMode === "live_feed"
        ? "Live Feed Desk"
        : "Desk Conversation";
  const currentSelectionLabel =
    sourceMode === "article" ? `${getCompositionLabel(selectedAnchors)} article mode` : getCompositionLabel(selectedAnchors);
  let currentMeta = storyPacket?.event_time_window ?? "Demo";
  if (sourceMode === "article") {
    currentMeta = storyPacket?.sourceSiteName ?? storyPacket?.sourceDomain ?? "Article mode";
  } else if (sourceMode === "live_feed") {
    switch (liveStatus.status) {
      case "fresh":
        currentMeta = "Live backend feed";
        break;
      case "stale":
        currentMeta = "Stale live packet";
        break;
      case "invalid_contract":
        currentMeta = "Invalid live contract";
        break;
      case "misconfigured":
        currentMeta = "Live feed not configured";
        break;
      case "upstream_error":
        currentMeta = "Live backend error";
        break;
      default:
        currentMeta = formatLiveStatusLabel(liveStatus.status);
        break;
    }
  }
  const promptReady = Boolean(
    storyPacket &&
      (sourceMode !== "article" || storyPacket.sourceType === "article") &&
      (sourceMode !== "live_feed" || storyPacket.sourceType === "live_feed"),
  );
  let promptBlockedReason: string | undefined;
  if (sourceMode === "article" && storyPacket?.sourceType !== "article") {
    promptBlockedReason = "Load an article from Setup & context to start.";
  } else if (sourceMode === "live_feed" && storyPacket?.sourceType !== "live_feed") {
    promptBlockedReason = "Wait for a live packet or switch to Demo.";
  }
  const stageTitle =
    selectedProfiles.length === 1
      ? selectedProfiles[0]?.label ?? "Speaker stage"
      : `${getCompositionLabel(selectedAnchors)} Stage`;
  const stagePillLabel =
    activeSpeaker
      ? `${anchors.find((profile) => profile.id === activeSpeaker)?.shortLabel ?? activeSpeaker} live`
      : selectedProfiles.length === 1
        ? sessions[selectedProfiles[0]?.id ?? "neutral"]?.status ?? "Standby"
        : `${selectedProfiles.length} on stage`;
  const stageLayoutClass =
    selectedProfiles.length >= 3 ? "speaker-grid-trio" : selectedProfiles.length === 2 ? "speaker-grid-duo" : "speaker-grid-solo";
  const canInterruptTurn = busy || activeSpeaker !== null;

  const activeAnchorTranscript = activeSpeaker
    ? sessions[activeSpeaker]?.transcript
    : selectedProfiles[0]?.id
      ? sessions[selectedProfiles[0]!.id]?.transcript
      : "";
  const isLive = activeSpeaker !== null;
  const timerLabel = `${String(Math.floor(liveTimerSeconds / 60)).padStart(2, "0")}:${String(liveTimerSeconds % 60).padStart(2, "0")}`;
  const turnCount = conversationGroups.length;

  return (
    <div className="shell">
      <NewsroomHud confidenceAverage={confidenceAverage} confidenceSampleCount={confidenceSampleCount} />
      <header className="top-bar">
        <div className="top-bar-brand">
          <span className={`live-indicator ${isLive ? "" : "live-indicator-standby"}`} aria-live="polite">
            <span className="live-indicator-dot" />
            {isLive ? "Live" : "Standby"}
          </span>
          {isLive ? <span className="live-timer">{timerLabel}</span> : null}
          <div className="top-bar-title">
            <p className="eyebrow">Election desk · {currentSelectionLabel}</p>
            <h1>{currentTitle}</h1>
          </div>
        </div>
        <div className="top-bar-meta">
          <span className="top-bar-chip">{providerMode === "mock" ? "Mock provider" : "LiveAvatar"}</span>
          <span className="top-bar-chip">{currentMeta}</span>
          {stagePillLabel ? <span className="top-bar-chip">{stagePillLabel}</span> : null}
        </div>
        <div className="top-bar-actions">
          <button
            type="button"
            className={`icon-button ${chromaKeyEnabled ? "icon-button-primary" : ""}`}
            onClick={() => setChromaKeyEnabled((v) => !v)}
            aria-pressed={chromaKeyEnabled}
            aria-label={chromaKeyEnabled ? "Disable newsroom backdrop" : "Enable newsroom backdrop"}
            title={chromaKeyEnabled ? "Newsroom backdrop on" : "Newsroom backdrop off"}
          >
            ▣
          </button>
          <button
            type="button"
            className="icon-button icon-button-primary"
            onClick={() => setSetupOpen(true)}
            aria-label="Open setup and context"
            title="Setup & context"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className={`stage ${feedOpen ? "stage-with-rail" : ""}`}>
        {selectedProfiles.length > 0 ? (
          <section className="anchor-stage" aria-label={stageTitle}>
            <h2 className="visually-hidden">{stageTitle}</h2>
            {selectedProfiles.length > 1 ? (
              <div className="anchor-tab-row">
                {selectedProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={`anchor-tab anchor-tab-${profile.id} ${activeSpeaker === profile.id ? "anchor-tab-selected" : ""}`}
                    onClick={() => handleToggleAnchor(profile.id)}
                  >
                    {profile.shortLabel}
                  </button>
                ))}
              </div>
            ) : null}

            <div className={`speaker-grid ${stageLayoutClass}`}>
              {selectedProfiles.map((profile) => (
                <AnchorCard
                  key={profile.id}
                  profile={profile}
                  runtimeStatus={anchorRuntimeStatus?.[profile.id]}
                  session={sessions[profile.id]}
                  anchors={anchors}
                  active={activeSpeaker === profile.id}
                  isMulti={selectedProfiles.length > 1}
                  isDebateActive={busy || activeSpeaker !== null}
                  activeTurnContext={activeSpeaker === profile.id ? activeTurnContext : null}
                  voiceReady={sourceMode !== "demo_story" && voiceInputAnchorId === profile.id}
                  listening={activeVoiceAnchorId === profile.id && isVoiceCaptureActive(voiceCaptureState)}
                  mediaRef={(element) => registerMediaElement(profile.id, element)}
                  chromaKey={chromaKeyEnabled}
                  factCheck={latestFactCheckByAnchor[profile.id]}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="stage-empty-hint">
            <p>No presenter selected. Open Setup &amp; context to pick anchors and start the stage.</p>
          </section>
        )}

        <section className="transcript-caption" aria-live="polite">
          <p className="transcript-caption-label">Latest line · {selectedProfiles.length === 1 ? selectedProfiles[0]?.label ?? "Desk" : stagePillLabel}</p>
          {activeAnchorTranscript ? (
            <p className="transcript-caption-text">{activeAnchorTranscript}</p>
          ) : (
            <p className="transcript-caption-text transcript-caption-empty">
              {selectedProfiles.length === 0 ? "Set up the desk to begin." : "This desk is ready for the next turn."}
            </p>
          )}
        </section>

        <ComposerPanel
          sourceMode={sourceMode}
          viewerPrompt={viewerPrompt}
          loadingLivePacket={loadingLivePacket}
          canRunPrompt={promptReady}
          runDisabledReason={promptBlockedReason}
          canInterrupt={canInterruptTurn}
          voiceCaptureState={voiceCaptureState}
          voiceDraftTranscript={voiceDraftTranscript}
          voiceListeningAnchorLabel={voiceAnchorLabel ?? "the moderator"}
          voiceAvailable={voiceAvailable}
          voiceBlockedReason={voiceBlockedReason}
          voiceError={voiceError}
          storyPacket={storyPacket}
          onPromptChange={setViewerPrompt}
          onRunPrompt={handleRunPrompt}
          onInterruptTurn={() => {
            void handleInterruptTurn();
          }}
          onVoiceStart={handleVoiceStart}
          onVoiceStop={handleVoiceStop}
          onComposerFocus={prewarmSelectedLiveSessions}
        />

        {conversationGroups.length === 0 && !feedOpen ? (
          <p className="empty-state">Responses will appear here after you ask the desk a question.</p>
        ) : null}
      </main>

      <AnimatePresence>
        {turnCount > 0 && !feedOpen ? (
          <motion.button
            key="feed-pill"
            type="button"
            className={`feed-pill ${activeQuestion && activeQuestion.status !== "done" && activeQuestion.status !== "failed" ? "feed-pill-active" : ""}`}
            onClick={() => setFeedOpen(true)}
            initial={{ opacity: 0, scale: 0.92, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -6 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            aria-label={`Open response feed (${turnCount} turns)`}
          >
            <span className="feed-pill-count">{turnCount}</span>
            <span>turns</span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {feedOpen ? (
          <motion.aside
            key="feed-rail"
            className="feed-rail"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 30 }}
            aria-label="Response feed"
          >
            <header className="feed-rail-header">
              <div>
                <p className="eyebrow">Latest turns</p>
                <h2>Response feed</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFeedOpen(false)}
                aria-label="Close response feed"
                title="Close"
              >
                ✕
              </button>
            </header>
            <div className="feed-rail-body">
              <HighlightReelPanel
                conversationGroups={conversationGroups}
                storyPacket={storyPacket}
                highlightSessionId={highlightSessionIdRef.current}
              />
              <PanelTurns
                conversations={conversationGroups}
                activeQuestionId={activeQuestion?.id ?? null}
                anchors={anchors}
                factChecks={factChecks}
              />
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {setupOpen ? (
          <>
            <motion.div
              key="setup-backdrop"
              className="setup-sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSetupOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              key="setup-sheet"
              className="setup-sheet"
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 30 }}
              aria-label="Setup and context"
            >
              <header className="setup-sheet-header">
                <div className="setup-sheet-title">
                  <p className="eyebrow">Setup</p>
                  <h2>Desk configuration</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSetupOpen(false)}
                  aria-label="Close setup"
                  title="Close"
                >
                  ✕
                </button>
              </header>
              <div className="setup-sheet-body">
                <ControlPanel
                  sourceMode={sourceMode}
                  liveFeedEnabled={liveFeedEnabled}
                  liveStatus={liveStatus}
                  loadingLivePacket={loadingLivePacket}
                  articleUrl={articleUrl}
                  articleError={articleError}
                  loadingArticle={loadingArticle}
                  selectedAnchors={selectedAnchors}
                  currentStoryId={storyPacket?.sourceType === "demo_story" ? storyPacket.id : demoStoryId}
                  stories={stories}
                  storyPacket={storyPacket}
                  anchors={anchors}
                  anchorRuntimeStatus={anchorRuntimeStatus}
                  sessions={sessions}
                  debateConfig={debateConfig}
                  llmConfig={llmConfig}
                  busy={busy}
                  connecting={connectingFeeds}
                  voiceCaptureState={voiceCaptureState}
                  onSourceModeChange={handleSourceModeChange}
                  onArticleUrlChange={setArticleUrl}
                  onLoadArticle={handleLoadArticle}
                  onToggleAnchor={handleToggleAnchor}
                  onSelectStory={handleSelectStory}
                  onStartStage={prepareStageStarter}
                  onDebateToneChange={handleDebateToneChange}
                  onOpeningSpeakerChange={handleOpeningSpeakerChange}
                  onDebateRoundsChange={handleDebateRoundsChange}
                  onModeratorBeatChange={handleModeratorBeatChange}
                  onLlmConfigChange={setLlmConfig}
                  onOpenAvatarGallery={providerMode === "full-api" ? () => setAvatarGalleryOpen(true) : undefined}
                />
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <AvatarGalleryModal
        open={avatarGalleryOpen}
        onClose={() => setAvatarGalleryOpen(false)}
        anchors={anchors}
        onApplied={() => {
          void api.bootstrap().then(async (payload) => {
            setAnchors(payload.anchors);
            setAnchorRuntimeStatus(payload.anchorRuntimeStatus);
            setSessions(payload.sessions);
            // Server has just rotated tokens for changed anchors. The warm RTC
            // sessions in liveSessionsRef still hold the OLD tokens and would
            // keep playing the previous avatar until the next user action.
            // Stop any whose key no longer matches and re-warm against the
            // fresh tokens so the picked avatars appear immediately.
            const nextSessions = payload.sessions;
            await Promise.all(
              selectedAnchorsRef.current.map(async (anchorId) => {
                const fresh = nextSessions[anchorId];
                if (!fresh) return;
                const freshKey = fresh.sessionAccessToken ? buildLiveSessionKey(fresh) : null;
                const liveKey = liveSessionKeysRef.current.get(anchorId);
                if (liveSessionsRef.current.has(anchorId) && liveKey !== freshKey) {
                  await stopLiveSession(anchorId);
                }
                if (fresh.sessionAccessToken) {
                  void ensureLiveSession(anchorId, fresh).catch(() => undefined);
                }
              }),
            );
          });
        }}
      />
    </div>
  );
}
