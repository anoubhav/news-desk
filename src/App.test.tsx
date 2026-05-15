import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnchorId,
  AnchorProfile,
  AnchorRuntimeStatus,
  AnchorSession,
  BootstrapResponse,
  LivePacketResponse,
  OrchestrateResponse,
  OrchestrateStreamFrame,
  SourceType,
  StoryPacket,
} from "@shared/models";
import App from "./App";
import { api } from "./lib/api";
import {
  AgentEventsEnum,
  createBrowserLiveSession,
  interruptSession,
  repeatAndWait,
  startVoiceCapture,
  stopVoiceCapture,
} from "./lib/liveavatar";

const liveAvatarState = vi.hoisted(() => {
  function buildSession() {
    const handlers = new Map<string, Set<(payload?: unknown) => void>>();

    return {
      on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const listeners = handlers.get(event) ?? new Set<(payload?: unknown) => void>();
        listeners.add(handler);
        handlers.set(event, listeners);
      }),
      off: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }),
      attach: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      interrupt: vi.fn(),
      voiceChat: {
        on: vi.fn(),
      },
      emit(event: string, payload?: unknown) {
        for (const handler of handlers.get(event) ?? []) {
          handler(payload);
        }
      },
    };
  }

  return {
    createdSessions: [] as ReturnType<typeof buildSession>[],
    buildSession,
  };
});

vi.mock("./lib/api", () => ({
  api: {
    bootstrap: vi.fn(),
    selectMode: vi.fn(),
    liveCurrent: vi.fn(),
    syncSessions: vi.fn(),
    refreshSession: vi.fn(),
    relaySessionEvent: vi.fn(),
    loadArticle: vi.fn(),
    askArticleStream: vi.fn(),
    selectStory: vi.fn(),
    orchestrateStream: vi.fn(),
    voiceTurnStream: vi.fn(),
    factCheck: vi.fn(),
  },
}));

vi.mock("./lib/liveavatar", () => ({
  AgentEventsEnum: {
    SESSION_STOPPED: "SESSION_STOPPED",
    AVATAR_TRANSCRIPTION: "AVATAR_TRANSCRIPTION",
    AVATAR_SPEAK_STARTED: "AVATAR_SPEAK_STARTED",
    AVATAR_SPEAK_ENDED: "AVATAR_SPEAK_ENDED",
    USER_SPEAK_STARTED: "USER_SPEAK_STARTED",
    USER_TRANSCRIPTION_CHUNK: "USER_TRANSCRIPTION_CHUNK",
    USER_TRANSCRIPTION: "USER_TRANSCRIPTION",
    USER_SPEAK_ENDED: "USER_SPEAK_ENDED",
  },
  LiveAvatarSession: class {},
  LiveSessionEvent: {
    SESSION_STREAM_READY: "SESSION_STREAM_READY",
    SESSION_DISCONNECTED: "SESSION_DISCONNECTED",
  },
  VoiceChatEvent: {
    STATE_CHANGED: "STATE_CHANGED",
  },
  createBrowserLiveSession: vi.fn(async (_token: string, _options?: unknown, prepare?: (session: unknown) => void) => {
    const session = liveAvatarState.buildSession();
    liveAvatarState.createdSessions.push(session);
    await prepare?.(session);
    return session;
  }),
  interruptSession: vi.fn(),
  repeatAndWait: vi.fn(async () => ({
    outcome: "ended",
    elapsedMs: 0,
  })),
  startVoiceCapture: vi.fn(async () => undefined),
  stopVoiceCapture: vi.fn(async () => undefined),
  waitForStreamReady: vi.fn(async () => undefined),
}));

const mockedApi = vi.mocked(api);
const mockedCreateBrowserLiveSession = vi.mocked(createBrowserLiveSession);
const mockedInterruptSession = vi.mocked(interruptSession);
const mockedRepeatAndWait = vi.mocked(repeatAndWait);
const mockedStartVoiceCapture = vi.mocked(startVoiceCapture);
const mockedStopVoiceCapture = vi.mocked(stopVoiceCapture);

const timestamp = "2026-04-10T09:00:00.000Z";
const defaultArticlePrompt =
  "Tell me the story in a clear, engaging way. Lead with the main development, explain why it matters, and end with what to watch next.";

async function* responseToStream(response: OrchestrateResponse): AsyncGenerator<OrchestrateStreamFrame> {
  yield {
    type: "session",
    storyPacket: response.storyPacket,
    sessions: response.sessions,
    selectedAnchors: response.selectedAnchors,
  };
  for (const turn of response.turns) {
    yield { type: "turn", turn };
  }
  yield { type: "done" };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function buildAnchor(id: AnchorId, label: string, shortLabel: string): AnchorProfile {
  return {
    id,
    label,
    shortLabel,
    leaning: id,
    accent: "neutral",
    openingText: `${label} online.`,
    instructions: `${label} instructions`,
    runtime: {
      contextName: `${id}-context`,
      contextMode: "dynamic",
      voiceFallbackNames: [`${label} Voice`],
    },
  };
}

function buildRuntimeStatus(): Record<AnchorId, AnchorRuntimeStatus> {
  return {
    neutral: {
      valid: true,
      sandbox: true,
      contextMode: "dynamic",
      configuredContextName: "neutral-context",
      voiceFallbackNames: ["Neutral Voice"],
      errors: [],
    },
    left: {
      valid: true,
      sandbox: true,
      contextMode: "dynamic",
      configuredContextName: "left-context",
      voiceFallbackNames: ["Left Voice"],
      errors: [],
    },
    right: {
      valid: true,
      sandbox: true,
      contextMode: "dynamic",
      configuredContextName: "right-context",
      voiceFallbackNames: ["Right Voice"],
      errors: [],
    },
  };
}

function buildSession(
  anchorId: AnchorId,
  overrides: Partial<AnchorSession> = {},
): AnchorSession {
  return {
    anchorId,
    sessionId: `${anchorId}-session`,
    status: "ready",
    providerMode: "full-api",
    prewarmed: anchorId === "neutral",
    lazy: anchorId !== "neutral",
    transcript: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    sandbox: true,
    isSelected: anchorId === "neutral",
    sessionAccessToken: `${anchorId}-token`,
    liveReady: false,
    ...overrides,
  };
}

function buildStoryPacket(sourceType: StoryPacket["sourceType"], overrides: Partial<StoryPacket> = {}): StoryPacket {
  return {
    id: `${sourceType}-story`,
    title: sourceType === "article" ? "Loaded Article" : "Demo Story",
    story_id: `${sourceType}-story-id`,
    sourceType,
    event_time_window: "This morning",
    topic: "Election",
    keywords_spiking: ["debate", "turnout"],
    neutral_summary: "Neutral summary.",
    left_framing_summary: "Left framing.",
    right_framing_summary: "Right framing.",
    consensus_points: ["Consensus point"],
    divergence_points: ["Divergence point"],
    sentiment_by_cluster: {
      neutral: "steady",
      left: "concerned",
      right: "aggressive",
    },
    ad_safety_state: "safe",
    confidence: 0.88,
    source_evidence: [],
    ...overrides,
  };
}

function buildSessions(
  activeAnchorId: AnchorId | null = null,
  selectedAnchors: AnchorId[] = ["neutral"],
): Record<AnchorId, AnchorSession> {
  return {
    neutral: buildSession("neutral", {
      sessionId: activeAnchorId === "neutral" ? "neutral-active" : selectedAnchors.includes("neutral") ? "neutral-standby" : "neutral-idle",
      isSelected: selectedAnchors.includes("neutral"),
      status: activeAnchorId === "neutral" ? "ready" : selectedAnchors.includes("neutral") ? "standby" : "idle",
      sessionAccessToken: activeAnchorId === "neutral" ? "neutral-active-token" : undefined,
      liveReady: activeAnchorId === "neutral",
    }),
    left: buildSession("left", {
      sessionId: activeAnchorId === "left" ? "left-active" : selectedAnchors.includes("left") ? "left-standby" : "left-idle",
      isSelected: selectedAnchors.includes("left"),
      status: activeAnchorId === "left" ? "ready" : selectedAnchors.includes("left") ? "standby" : "idle",
      sessionAccessToken: activeAnchorId === "left" ? "left-active-token" : undefined,
      liveReady: activeAnchorId === "left",
    }),
    right: buildSession("right", {
      sessionId: activeAnchorId === "right" ? "right-active" : selectedAnchors.includes("right") ? "right-standby" : "right-idle",
      isSelected: selectedAnchors.includes("right"),
      status: activeAnchorId === "right" ? "ready" : selectedAnchors.includes("right") ? "standby" : "idle",
      sessionAccessToken: activeAnchorId === "right" ? "right-active-token" : undefined,
      liveReady: activeAnchorId === "right",
    }),
  };
}

function buildDemoStoryPacket() {
  return buildStoryPacket("demo_story", {
    id: "demo-1",
    story_id: "demo-1",
    title: "Opening Demo Story",
    neutral_summary: "Demo story summary.",
  });
}

function buildBootstrapResponse(options?: {
  sourceMode?: SourceType;
  selectedAnchors?: AnchorId[];
  storyPacket?: StoryPacket | null;
  liveFeedEnabled?: boolean;
  liveStatus?: LivePacketResponse;
}): BootstrapResponse {
  const sourceMode = options?.sourceMode ?? "demo_story";
  const storyPacket =
    options?.storyPacket ??
    (sourceMode === "demo_story" ? buildDemoStoryPacket() : null);
  const selectedAnchors = options?.selectedAnchors ?? ["neutral"];

  return {
    anchors: [
      buildAnchor("neutral", "Neutral Desk", "Neutral"),
      buildAnchor("left", "Left Desk", "Left"),
      buildAnchor("right", "Right Desk", "Right"),
    ],
    anchorRuntimeStatus: buildRuntimeStatus(),
    sourceMode,
    sessions: buildSessions(null, selectedAnchors),
    selectedAnchors,
    storyPacket,
    availableStories: [buildDemoStoryPacket()],
    providerMode: "full-api",
    liveFeedEnabled: options?.liveFeedEnabled ?? false,
    liveFeedPollMs: 5000,
    liveStatus: options?.liveStatus ?? buildLiveStatus(),
  };
}

function buildArticleLoadResponse() {
  const storyPacket = buildStoryPacket("article", {
    id: "article-story",
    story_id: "article-story-id",
    title: "Article Desk Story",
    sourceTitle: "Election Story",
    sourceSiteName: "Example News",
    sourceUrl: "https://example.com/article",
    sourcePublishedAt: "2026-04-09T10:30:00Z",
    articleBody: "A detailed article body.",
    articleSnippets: ["Snippet one", "Snippet two"],
    neutral_summary: "Article summary for the desk.",
  });
  const sessions = buildSessions(null, ["neutral"]);

  return {
    storyPacket,
    sessions,
    selectedAnchors: ["neutral"] as AnchorId[],
  };
}

function buildArticleAskResponse(): OrchestrateResponse {
  const articleLoad = buildArticleLoadResponse();

  return {
    storyPacket: articleLoad.storyPacket,
    sessions: articleLoad.sessions,
    selectedAnchors: articleLoad.selectedAnchors,
    turns: [
      {
        turnId: "turn-1",
        anchorId: "neutral",
        anchorLabel: "Neutral Desk",
        responseGoal: "catch_up",
        transcript: "Here is the article summary.",
        citedEvidence: [],
        generationSource: "article",
        roundIndex: 0,
        startedAt: timestamp,
        completedAt: timestamp,
        events: [],
      },
    ],
  };
}

function buildDualArticleResponse(): OrchestrateResponse {
  const storyPacket = buildStoryPacket("article", {
    id: "article-debate-story",
    story_id: "article-debate-story-id",
    title: "Article Debate Story",
    sourceTitle: "Election Story",
    sourceSiteName: "Example News",
    sourceUrl: "https://example.com/article",
    sourcePublishedAt: "2026-04-09T10:30:00Z",
    articleBody: "A detailed article body.",
    articleSnippets: ["Snippet one", "Snippet two"],
    neutral_summary: "Article summary for the desk.",
  });

  return {
    storyPacket,
    sessions: buildSessions(null, ["neutral", "left"]),
    selectedAnchors: ["neutral", "left"],
    turns: [
      {
        turnId: "turn-1",
        anchorId: "neutral",
        anchorLabel: "Neutral Desk",
        responseGoal: "compare",
        transcript: "Neutral Desk opens the article debate.",
        citedEvidence: [],
        generationSource: "article",
        roundIndex: 0,
        startedAt: timestamp,
        completedAt: timestamp,
        events: [],
      },
      {
        turnId: "turn-2",
        anchorId: "left",
        anchorLabel: "Left Desk",
        responseGoal: "compare",
        transcript: "Left Desk replies with an article-grounded counterpoint.",
        citedEvidence: [],
        generationSource: "article",
        priorAnchorId: "neutral",
        roundIndex: 0,
        startedAt: timestamp,
        completedAt: timestamp,
        events: [],
      },
    ],
  };
}

function buildLiveStatus(): LivePacketResponse {
  return {
    storyPacket: null,
    fetchedAt: timestamp,
    status: "misconfigured",
    stale: false,
    upstreamAvailable: false,
    errorCode: "misconfigured",
  };
}

async function renderApp() {
  render(<App />);
  await screen.findByRole("heading", { name: "Desk Conversation" });
}

async function openSetup(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.queryByLabelText("Open setup and context");
  if (trigger) {
    await user.click(trigger);
    await screen.findByRole("heading", { name: "Desk configuration" });
  }
}

async function openFeed(user: ReturnType<typeof userEvent.setup>) {
  const pill = screen.queryByRole("button", { name: /^Open response feed/ });
  if (pill) {
    await user.click(pill);
  }
}

async function loadArticle(user: ReturnType<typeof userEvent.setup>) {
  await openSetup(user);
  await user.click(screen.getByRole("button", { name: "Article" }));

  const urlInput = screen.getByLabelText("Public article URL");
  await user.clear(urlInput);
  await user.type(urlInput, "https://example.com/article");
  await user.click(screen.getByRole("button", { name: "Load article" }));

  await waitFor(() => expect(mockedApi.loadArticle).toHaveBeenCalledTimes(1));
  await screen.findByRole("heading", { name: "Article Desk" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Tell the story" })).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Start stage" })).toBeEnabled());

  return {
    urlInput,
    promptInput: screen.getByLabelText("Story prompt or follow-up"),
  };
}

async function startArticleLoad(user: ReturnType<typeof userEvent.setup>) {
  const loaded = await loadArticle(user);
  await user.click(screen.getByRole("button", { name: "Tell the story" }));
  await waitFor(() => expect(mockedApi.askArticleStream).toHaveBeenCalledTimes(1));

  return {
    ...loaded,
    promptInput: screen.getByLabelText("Story prompt or follow-up"),
  };
}

describe("App voice interactions", () => {
  let refreshCount = 0;
  let currentSourceModeForMock: SourceType = "demo_story";
  let currentDemoStoryForMock = buildDemoStoryPacket();
  let loadedArticleForMock: StoryPacket | null = null;
  let selectedAnchorsByModeForMock: Record<SourceType, AnchorId[]>;

  beforeEach(() => {
    refreshCount = 0;
    currentSourceModeForMock = "demo_story";
    currentDemoStoryForMock = buildDemoStoryPacket();
    loadedArticleForMock = null;
    selectedAnchorsByModeForMock = {
      demo_story: ["neutral"],
      article: ["neutral"],
      live_feed: ["neutral"],
    };
    liveAvatarState.createdSessions.length = 0;
    vi.clearAllMocks();

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    mockedApi.bootstrap.mockImplementation(async () =>
      buildBootstrapResponse({
        sourceMode: currentSourceModeForMock,
        selectedAnchors: selectedAnchorsByModeForMock[currentSourceModeForMock],
        storyPacket:
          currentSourceModeForMock === "article"
            ? loadedArticleForMock
            : currentSourceModeForMock === "demo_story"
              ? currentDemoStoryForMock
              : null,
      }),
    );
    mockedApi.selectMode.mockImplementation(async ({ sourceMode }) => {
      currentSourceModeForMock = sourceMode;
      return {
        sourceMode,
        sessions: buildSessions(null, selectedAnchorsByModeForMock[sourceMode]),
        selectedAnchors: selectedAnchorsByModeForMock[sourceMode],
        storyPacket:
          sourceMode === "article"
            ? loadedArticleForMock
            : sourceMode === "demo_story"
              ? currentDemoStoryForMock
              : null,
        liveStatus: buildLiveStatus(),
      };
    });
    mockedApi.liveCurrent.mockResolvedValue(buildLiveStatus());
    mockedApi.syncSessions.mockImplementation(async ({ selectedAnchors }) => {
      selectedAnchorsByModeForMock[currentSourceModeForMock] = selectedAnchors;
      return {
        sessions: buildSessions(null, selectedAnchors),
        selectedAnchors,
      };
    });
    mockedApi.refreshSession.mockImplementation(async ({ anchorId }) => {
      refreshCount += 1;
      const sessions = buildSessions(anchorId, selectedAnchorsByModeForMock[currentSourceModeForMock]);
      return {
        session: {
          ...sessions[anchorId],
          sessionId: `${anchorId}-refresh-${refreshCount}`,
          sessionAccessToken: `${anchorId}-refresh-token-${refreshCount}`,
          liveReady: false,
        },
        sessions: {
          ...sessions,
          [anchorId]: {
            ...sessions[anchorId],
            sessionId: `${anchorId}-refresh-${refreshCount}`,
            sessionAccessToken: `${anchorId}-refresh-token-${refreshCount}`,
            liveReady: false,
          },
        },
      };
    });
    mockedApi.relaySessionEvent.mockImplementation(async ({ anchorId, sessionId }) => ({
      accepted: true,
      session: buildSession(anchorId, {
        sessionId,
        isSelected: selectedAnchorsByModeForMock[currentSourceModeForMock].includes(anchorId),
        status: selectedAnchorsByModeForMock[currentSourceModeForMock].includes(anchorId) ? "standby" : "idle",
        sessionAccessToken: undefined,
      }),
    }));
    mockedApi.loadArticle.mockImplementation(async () => {
      const payload = buildArticleLoadResponse();
      loadedArticleForMock = payload.storyPacket;
      currentSourceModeForMock = "article";
      return {
        ...payload,
        sessions: buildSessions(null, selectedAnchorsByModeForMock.article),
        selectedAnchors: selectedAnchorsByModeForMock.article,
      };
    });
    mockedApi.askArticleStream.mockImplementation(({ selectedAnchors }) => {
      const nextSelection = selectedAnchors ?? selectedAnchorsByModeForMock.article;
      selectedAnchorsByModeForMock.article = nextSelection;
      currentSourceModeForMock = "article";
      const base = nextSelection.length > 1 ? buildDualArticleResponse() : buildArticleAskResponse();
      return responseToStream({
        ...base,
        sessions: buildSessions(null, nextSelection),
        selectedAnchors: nextSelection,
      });
    });
    mockedApi.selectStory.mockResolvedValue({
      storyPacket: currentDemoStoryForMock,
    });
    mockedApi.orchestrateStream.mockImplementation(({ selectedAnchors }) =>
      responseToStream({
        ...buildArticleAskResponse(),
        sessions: buildSessions(null, selectedAnchors ?? selectedAnchorsByModeForMock[currentSourceModeForMock]),
        selectedAnchors: selectedAnchors ?? selectedAnchorsByModeForMock[currentSourceModeForMock],
      }),
    );
    mockedApi.voiceTurnStream.mockImplementation(({ selectedAnchors }) => {
      const modeForVoice = currentSourceModeForMock === "demo_story" ? "article" : currentSourceModeForMock;
      const nextSelection = selectedAnchors ?? selectedAnchorsByModeForMock[modeForVoice];
      selectedAnchorsByModeForMock[modeForVoice] = nextSelection;
      const base = nextSelection.length > 1 ? buildDualArticleResponse() : buildArticleAskResponse();
      return responseToStream({
        ...base,
        sessions: buildSessions(null, nextSelection),
        selectedAnchors: nextSelection,
      });
    });
    mockedApi.factCheck.mockImplementation(async ({ turnId }) => ({
      turnId,
      confidence: null,
      mode: "unavailable",
      claims: [],
      generatedAt: new Date().toISOString(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses one unified composer for typing and voice after an article load", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    expect(mockedApi.askArticleStream).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Text" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voice" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
    expect(screen.getByLabelText("Story prompt or follow-up")).toBeInTheDocument();
  });

  it("does not auto-start an article response when the article loads", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    expect(mockedApi.askArticleStream).not.toHaveBeenCalled();
    expect(mockedCreateBrowserLiveSession).not.toHaveBeenCalled();
    expect(screen.getByText("Responses will appear here after you ask the desk a question.")).toBeInTheDocument();
  });

  it("renders selected article presenters side by side without stage moderator controls", async () => {
    const user = userEvent.setup();

    await renderApp();
    await loadArticle(user);

    await user.click(screen.getAllByRole("button", { name: /^Left/i })[0]);

    const stage = screen.getByRole("heading", { name: "Neutral + Left Stage" }).closest("section");
    expect(stage).not.toBeNull();

    await waitFor(() => expect(within(stage!).getByRole("heading", { name: "Neutral Desk", level: 3 })).toBeInTheDocument());
    expect(within(stage!).getByRole("heading", { name: "Left Desk", level: 3 })).toBeInTheDocument();
    expect(within(stage!).queryByRole("button", { name: "Interrupt turn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with auto order" })).not.toBeInTheDocument();
  });

  it("sends debate config with selected article presenters from the simplified setup controls", async () => {
    const user = userEvent.setup();
    const dualResponse = buildDualArticleResponse();

    await renderApp();
    await loadArticle(user);

    await user.click(screen.getAllByRole("button", { name: /^Left/i })[0]);

    mockedApi.askArticleStream.mockReturnValueOnce(responseToStream(dualResponse));

    await user.click(screen.getAllByRole("button", { name: "Left" }).at(-1)!);
    await user.click(screen.getByRole("button", { name: "Aggressive" }));
    await user.click(screen.getByRole("button", { name: "Tell the story" }));

    await waitFor(() =>
      expect(mockedApi.askArticleStream).toHaveBeenLastCalledWith(
        expect.objectContaining({
          question: defaultArticlePrompt,
          selectedAnchors: ["neutral", "left"],
          debateConfig: expect.objectContaining({
            tone: "aggressive",
            openingSpeaker: "left",
          }),
        }),
      ),
    );
  });

  it("pre-warms a live session for every selected presenter when Start stage is pressed", async () => {
    const user = userEvent.setup();

    await renderApp();
    await loadArticle(user);

    const createdSessionsBefore = mockedCreateBrowserLiveSession.mock.calls.length;

    await user.click(screen.getAllByRole("button", { name: /^Left/i })[0]);
    await user.click(screen.getByRole("button", { name: "Start stage" }));

    // Both neutral and left should be pre-warmed so the speaker handoff is
    // instant; before this change only the starter was warmed.
    await waitFor(() =>
      expect(mockedCreateBrowserLiveSession.mock.calls.length).toBe(createdSessionsBefore + 2),
    );
  });

  it("keeps hold-to-talk enabled through preparing, listening, and transcribing", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    const deferredVoiceStart = createDeferred<void>();
    mockedStartVoiceCapture.mockImplementationOnce(() => deferredVoiceStart.promise);

    const holdButton = screen.getByRole("button", { name: "Hold to talk" });
    fireEvent.pointerDown(holdButton);

    await waitFor(() => expect(mockedStartVoiceCapture).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Preparing mic..." })).toBeEnabled());

    deferredVoiceStart.resolve(undefined);

    await waitFor(() => expect(screen.getByRole("button", { name: "Release to send" })).toBeEnabled());

    fireEvent.pointerUp(screen.getByRole("button", { name: "Release to send" }));
    await waitFor(() => expect(mockedStopVoiceCapture).toHaveBeenCalledTimes(1));

    act(() => {
      liveAvatarState.createdSessions.at(-1)?.emit(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, {
        text: "What changed in the article?",
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Transcribing..." })).toBeEnabled());
  });

  it("starts voice from text mode when Z is pressed after an article load", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    fireEvent.keyDown(window, { key: "z" });

    await waitFor(() => expect(mockedStartVoiceCapture).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Release to send" })).toBeInTheDocument());

    fireEvent.keyUp(window, { key: "z" });
    await waitFor(() => expect(mockedStopVoiceCapture).toHaveBeenCalledTimes(1));
  });

  it("ignores Z while the article URL input is focused", async () => {
    const user = userEvent.setup();
    await renderApp();
    const { urlInput } = await loadArticle(user);

    await act(async () => {
      urlInput.focus();
    });

    fireEvent.keyDown(urlInput, { key: "z" });
    fireEvent.keyUp(urlInput, { key: "z" });

    await waitFor(() => expect(urlInput).toHaveFocus());
    expect(mockedStartVoiceCapture).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  });

  it("ignores Z while the prompt textarea is focused", async () => {
    const user = userEvent.setup();
    await renderApp();
    const { promptInput } = await loadArticle(user);

    await act(async () => {
      promptInput.focus();
    });

    fireEvent.keyDown(promptInput, { key: "z" });
    fireEvent.keyUp(promptInput, { key: "z" });

    await waitFor(() => expect(promptInput).toHaveFocus());
    expect(mockedStartVoiceCapture).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  });

  it("keeps article autoplay on the same unified session path", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    expect(mockedCreateBrowserLiveSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  });

  it("shows typed questions in the feed with the answer grouped beneath them", async () => {
    const user = userEvent.setup();
    await renderApp();
    await startArticleLoad(user);

    const feedHeading = await screen.findByRole("heading", { name: "Response feed" });
    const feed = feedHeading.closest("aside, section");
    expect(feed).not.toBeNull();

    const responseFeed = within(feed as HTMLElement);
    expect(responseFeed.getByText("You")).toBeInTheDocument();
    expect(responseFeed.getByText("Typed prompt")).toBeInTheDocument();
    expect(responseFeed.getByText(defaultArticlePrompt)).toBeInTheDocument();
    expect(responseFeed.getByText("Here is the article summary.")).toBeInTheDocument();
  });

  it("surfaces the active typed question status in the response feed until the answer finishes", async () => {
    const user = userEvent.setup();
    const playbackDeferred = createDeferred<{ outcome: "ended"; elapsedMs: number }>();
    mockedRepeatAndWait.mockImplementationOnce(() => playbackDeferred.promise);

    await renderApp();
    await startArticleLoad(user);

    const feedHeading = await screen.findByRole("heading", { name: "Response feed" });
    const feed = feedHeading.closest("aside, section") as HTMLElement;
    expect(feed).not.toBeNull();

    await waitFor(() => expect(within(feed).getByText("Answering now")).toBeInTheDocument());
    expect(within(feed).getByText(defaultArticlePrompt)).toBeInTheDocument();

    playbackDeferred.resolve({ outcome: "ended", elapsedMs: 0 });

    await waitFor(() => expect(within(feed).queryByText("Answering now")).not.toBeInTheDocument());
  });

  it("interrupts active playback immediately when a voice question starts", async () => {
    const user = userEvent.setup();
    const playbackDeferred = createDeferred<{ outcome: "ended"; elapsedMs: number }>();
    mockedRepeatAndWait.mockImplementationOnce(() => playbackDeferred.promise);

    await renderApp();
    await startArticleLoad(user);

    const feedHeading = await screen.findByRole("heading", { name: "Response feed" });
    const feed = feedHeading.closest("aside, section") as HTMLElement;
    expect(feed).not.toBeNull();

    await waitFor(() => expect(within(feed).getByText("Answering now")).toBeInTheDocument());
    const interruptCallsBeforeVoice = mockedInterruptSession.mock.calls.length;

    const holdButton = screen.getByRole("button", { name: "Hold to talk" });
    fireEvent.pointerDown(holdButton);

    await waitFor(() => expect(mockedInterruptSession).toHaveBeenCalledTimes(interruptCallsBeforeVoice + 1));
    await waitFor(() => expect(mockedStartVoiceCapture).toHaveBeenCalledTimes(1));
    // Composer flips into listening mode — the hold button relabels to "Release to send".
    await waitFor(() => expect(screen.getByRole("button", { name: "Release to send" })).toBeInTheDocument());

    const browserSession = liveAvatarState.createdSessions.at(-1);
    act(() => {
      browserSession?.emit(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, {
        text: "What evidence matters most here?",
      });
    });

    playbackDeferred.resolve({ outcome: "ended", elapsedMs: 0 });

    fireEvent.pointerUp(screen.getByRole("button", { name: "Release to send" }));

    await waitFor(() =>
      expect(mockedApi.voiceTurnStream).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: "What evidence matters most here?",
        }),
      ),
    );
  });

  it("interrupts active playback immediately when a typed follow-up is submitted", async () => {
    const user = userEvent.setup();
    const firstPlaybackDeferred = createDeferred<{ outcome: "ended"; elapsedMs: number }>();
    const secondPlaybackDeferred = createDeferred<{ outcome: "ended"; elapsedMs: number }>();
    mockedRepeatAndWait
      .mockImplementationOnce(() => firstPlaybackDeferred.promise)
      .mockImplementationOnce(() => secondPlaybackDeferred.promise);

    await renderApp();
    const { promptInput } = await startArticleLoad(user);

    const nextPrompt = "Which source backs this claim most clearly?";
    await waitFor(() => expect(screen.getByRole("button", { name: "Tell the story" })).toBeEnabled());
    const interruptCallsBeforeSubmit = mockedInterruptSession.mock.calls.length;
    await user.clear(promptInput);
    await user.type(promptInput, nextPrompt);
    await user.click(screen.getByRole("button", { name: "Tell the story" }));

    await waitFor(() => expect(mockedInterruptSession).toHaveBeenCalledTimes(interruptCallsBeforeSubmit + 1));
    await waitFor(() => expect(mockedApi.askArticleStream).toHaveBeenCalledTimes(2));

    const feedHeading = await screen.findByRole("heading", { name: "Response feed" });
    const feed = feedHeading.closest("aside, section");
    expect(feed).not.toBeNull();
    await waitFor(() => expect(within(feed as HTMLElement).getByText(nextPrompt)).toBeInTheDocument());

    secondPlaybackDeferred.resolve({ outcome: "ended", elapsedMs: 0 });
    firstPlaybackDeferred.resolve({ outcome: "ended", elapsedMs: 0 });
  });

  it("interrupts active playback before a new article load request completes", async () => {
    const user = userEvent.setup();
    const playbackDeferred = createDeferred<{ outcome: "ended"; elapsedMs: number }>();
    const articleReloadDeferred = createDeferred<ReturnType<typeof buildArticleLoadResponse>>();
    mockedRepeatAndWait.mockImplementationOnce(() => playbackDeferred.promise);

    await renderApp();
    const { urlInput } = await startArticleLoad(user);

    await waitFor(() => expect(screen.getByText("Answering now")).toBeInTheDocument());
    const interruptCallsBeforeReload = mockedInterruptSession.mock.calls.length;
    mockedApi.loadArticle.mockImplementationOnce(() => articleReloadDeferred.promise);

    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com/reload-article");
    await user.click(screen.getByRole("button", { name: "Load article" }));

    await waitFor(() => expect(mockedApi.loadArticle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedInterruptSession).toHaveBeenCalledTimes(interruptCallsBeforeReload + 1));

    articleReloadDeferred.resolve(buildArticleLoadResponse());
    playbackDeferred.resolve({ outcome: "ended", elapsedMs: 0 });
  });

  it("adds a voice question to the feed using the latest transcript text", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Hold to talk" }));
    await waitFor(() => expect(mockedStartVoiceCapture).toHaveBeenCalledTimes(1));

    const browserSession = liveAvatarState.createdSessions.at(-1);
    act(() => {
      browserSession?.emit(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, {
        text: "Who is named in the article?",
      });
    });

    fireEvent.pointerUp(screen.getByRole("button", { name: "Release to send" }));

    await waitFor(() =>
      expect(mockedApi.voiceTurnStream).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: "Who is named in the article?",
        }),
      ),
    );

    const feedHeading = await screen.findByRole("heading", { name: "Response feed" });
    const feed = feedHeading.closest("aside, section");
    expect(feed).not.toBeNull();

    const responseFeed = within(feed as HTMLElement);
    expect(responseFeed.getAllByText("You")).toHaveLength(1);
    expect(responseFeed.getByText("Voice question")).toBeInTheDocument();
    expect(responseFeed.getByText("Who is named in the article?")).toBeInTheDocument();
  });

  it("preserves the article presenter roster when switching away and back", async () => {
    const user = userEvent.setup();
    await renderApp();
    await loadArticle(user);

    await user.click(screen.getAllByRole("button", { name: /^Left/i })[0]);
    await waitFor(() => expect(mockedApi.syncSessions).toHaveBeenCalledWith({ selectedAnchors: ["neutral", "left"] }));

    await user.click(screen.getByRole("button", { name: "Demo" }));
    await screen.findByRole("heading", { name: "Desk Conversation" });

    await user.click(screen.getByRole("button", { name: "Article" }));
    await screen.findByRole("heading", { name: "Article Desk" });

    const stage = screen.getByRole("heading", { name: "Neutral + Left Stage" }).closest("section");
    expect(stage).not.toBeNull();
    expect(within(stage!).getByRole("heading", { name: "Left Desk", level: 3 })).toBeInTheDocument();
  });

  it("honors bootstrap source mode even when live feed status is fresh", async () => {
    mockedApi.bootstrap.mockResolvedValueOnce(
      buildBootstrapResponse({
        sourceMode: "article",
        selectedAnchors: ["neutral"],
        storyPacket: buildArticleLoadResponse().storyPacket,
        liveFeedEnabled: true,
        liveStatus: {
          ...buildLiveStatus(),
          status: "fresh",
          storyPacket: buildStoryPacket("live_feed", {
            id: "live-story",
            story_id: "live-story",
            title: "Fresh Live Story",
          }),
          upstreamAvailable: true,
        },
      }),
    );

    render(<App />);
    await screen.findByRole("heading", { name: "Article Desk" });
    expect(screen.queryByRole("heading", { name: "Live Feed Desk" })).not.toBeInTheDocument();
  });

  it("renders a retry state when bootstrap fails", async () => {
    mockedApi.bootstrap.mockRejectedValueOnce(new Error("Bootstrap failed."));

    render(<App />);

    await screen.findByRole("heading", { name: "Could not load the election desk" });
    expect(screen.getByText("Bootstrap failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
