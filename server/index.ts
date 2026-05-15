import express from "express";
import cors from "cors";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { anchorIds, debateTonePresets, sourceTypes, type AnchorId, type SourceType } from "../shared/models";
import type {
  AnchorProfile,
  AnchorRuntimeConfigRequest,
  AnchorRuntimeConfigResponse,
  AnchorSession,
  ArticleAskRequest,
  ArticleLoadRequest,
  ArticleLoadResponse,
  AvatarPreviewStopRequest,
  AvatarPreviewStopResponse,
  AvatarPreviewTokenRequest,
  AvatarPreviewTokenResponse,
  BootstrapResponse,
  FactCheckRequest,
  FactCheckResult,
  LivePacketResponse,
  OrchestrateRequest,
  PanelTurn,
  PublicAvatarsResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  RelaySessionEventRequest,
  RelaySessionEventResponse,
  SelectModeRequest,
  SelectModeResponse,
  SelectStoryRequest,
  SelectStoryResponse,
  StoryPacket,
  SyncSessionsRequest,
  SyncSessionsResponse,
  VoiceTurnRequest,
} from "../shared/models";
import { mkdirSync, writeFileSync, existsSync as existsSyncFs, readFileSync, statSync } from "node:fs";
import { anchorProfiles, anchorRuntimeStatus } from "./data/anchors";
import { storyPackets } from "./data/stories";
import { buildHighlightManifest } from "./services/highlightReel/buildManifest";
import { renderHighlight } from "./services/highlightReel/renderer";
import { buildHudContext } from "./services/hudContext/builder";
import { buildArticleAnchorProfiles, loadArticlePacket } from "./services/articleSource";
import { createProvider } from "./services/liveavatar";
import { getConfiguredLiveAvatarApiKey } from "./services/liveavatar/anchorRuntime";
import { LiveSourceService } from "./services/liveSource";
import { createLiveResponseBuilder } from "./services/liveResponse";
import { buildUnavailableResult, createFactCheckProvider } from "./services/factCheck/builder";
import { orchestratePanel } from "./services/orchestrator";
import { AnchorSessionManager } from "./state/sessionManager";
import { config } from "./config";

const app = express();

const basicAuthUser = config.basicAuth.user ?? "";
const basicAuthPass = config.basicAuth.pass ?? "";
if (basicAuthUser && basicAuthPass) {
  const expectedUser = Buffer.from(basicAuthUser);
  const expectedPass = Buffer.from(basicAuthPass);
  app.use((req, res, next) => {
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        const providedUser = Buffer.from(decoded.slice(0, idx));
        const providedPass = Buffer.from(decoded.slice(idx + 1));
        const userOk =
          providedUser.length === expectedUser.length &&
          timingSafeEqual(providedUser, expectedUser);
        const passOk =
          providedPass.length === expectedPass.length &&
          timingSafeEqual(providedPass, expectedPass);
        if (userOk && passOk) {
          return next();
        }
      }
    }
    res.set("WWW-Authenticate", 'Basic realm="Live Avatar Election Desk", charset="UTF-8"');
    res.status(401).send("Authentication required.");
  });
}

app.use(cors());
app.use(express.json());

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(currentDir);
const distDir = join(projectRoot, "dist");
const port = config.port;
const provider = createProvider(config.liveAvatar);
const liveSourceService = new LiveSourceService(config.liveSource);
const liveResponseBuilder = createLiveResponseBuilder(config.llm);
const factCheckProvider = createFactCheckProvider(config.llm);
const anchorProfileMap = Object.fromEntries(
  anchorProfiles.map((profile) => [profile.id, profile]),
) as Record<AnchorId, (typeof anchorProfiles)[number]>;
const sessionManager = new AnchorSessionManager(provider, anchorProfileMap);

type SelectedAnchorsByMode = Record<SourceType, AnchorId[]>;

function buildSelectedAnchorsByMode(): SelectedAnchorsByMode {
  return {
    demo_story: ["neutral"],
    article: ["neutral"],
    live_feed: ["neutral"],
  };
}

let selectedAnchorsByMode: SelectedAnchorsByMode = buildSelectedAnchorsByMode();
let activeStoryId = storyPackets[0].id;
let loadedArticlePacket: StoryPacket | null = null;
let activeSourceMode: SourceType = liveSourceService.isEnabled() ? "live_feed" : "demo_story";
let selectedAnchors: AnchorId[] = [...selectedAnchorsByMode[activeSourceMode]];

const selectionSchema = z.object({
  selectedAnchors: z.array(z.enum(anchorIds)).min(1),
});

const modeSelectionSchema = z.object({
  sourceMode: z.enum(sourceTypes),
});

const debateConfigSchema = z.object({
  tone: z.enum(debateTonePresets).optional(),
  openingSpeaker: z.union([z.literal("auto"), z.enum(anchorIds)]).optional(),
  debateRounds: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  includeModeratorBeat: z.boolean().optional(),
});

const sessionTranscriptSchema = z
  .array(
    z.object({
      role: z.enum(["host", "anchor"]),
      anchorId: z.enum(anchorIds).optional(),
      anchorLabel: z.string().optional(),
      text: z.string().min(1),
      roundIndex: z.number().int().optional(),
      startedAt: z.string().optional(),
      replyToAnchorId: z.enum(anchorIds).optional(),
    }),
  )
  .optional();

const storySelectionSchema = z.object({
  storyId: z.string().min(1),
});

const articleLoadSchema = z.object({
  url: z.string().min(1),
});

const llmOverrideSchema = z
  .object({
    modelPreset: z.enum(["default", "gpt-5.5"]).optional(),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  })
  .optional();

const articleAskSchema = z.object({
  question: z.string().min(1),
  selectedAnchors: z.array(z.enum(anchorIds)).min(1).optional(),
  debateConfig: debateConfigSchema.optional(),
  sessionTranscript: sessionTranscriptSchema,
  llm: llmOverrideSchema,
});

const relayEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.stream_ready"),
    timestamp: z.string().min(1),
  }),
  z.object({
    type: z.literal("session.disconnected"),
    timestamp: z.string().min(1),
    reason: z.string().min(1).catch("UNKNOWN_REASON"),
  }),
  z.object({
    type: z.literal("session.stopped"),
    timestamp: z.string().min(1),
    stopReason: z.string().min(1).catch("UNKNOWN_REASON"),
    eventId: z.string().min(1).optional(),
    sourceEventId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    type: z.literal("avatar.speak_started"),
    timestamp: z.string().min(1),
    eventId: z.string().min(1).catch("relay-missing-event-id"),
    sourceEventId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    type: z.literal("avatar.transcription"),
    timestamp: z.string().min(1),
    eventId: z.string().min(1).catch("relay-missing-event-id"),
    sourceEventId: z.string().min(1).nullable().optional(),
    text: z.string().catch(""),
  }),
  z.object({
    type: z.literal("avatar.speak_ended"),
    timestamp: z.string().min(1),
    eventId: z.string().min(1).catch("relay-missing-event-id"),
    sourceEventId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    type: z.literal("client.runtime_error"),
    timestamp: z.string().min(1),
    phase: z.enum(["start", "stream_wait", "playback", "attach"]),
    message: z.string().min(1),
  }),
]);

const relaySessionEventSchema = z.object({
  anchorId: z.enum(anchorIds),
  sessionId: z.string().min(1),
  event: relayEventSchema,
});

const refreshSessionSchema = z.object({
  anchorId: z.enum(anchorIds),
});

const orchestrationSchema = z.object({
  selectedAnchors: z.array(z.enum(anchorIds)).min(1).optional(),
  viewerPrompt: z.string().min(1),
  storyId: z.string().optional(),
  debateConfig: debateConfigSchema.optional(),
  sessionTranscript: sessionTranscriptSchema,
  llm: llmOverrideSchema,
});

const voiceTurnSchema = z.object({
  sourceMode: z.enum(["article", "live_feed"]),
  transcript: z.string().min(1),
  selectedAnchors: z.array(z.enum(anchorIds)).min(1).optional(),
  debateConfig: debateConfigSchema.optional(),
  sessionTranscript: sessionTranscriptSchema,
  llm: llmOverrideSchema,
});

const factCheckArticleContextSchema = z.object({
  sourceUrl: z.string().url().max(2000).optional(),
  sourceTitle: z.string().max(500).optional(),
  sourceDomain: z.string().max(200).optional(),
  neutralSummary: z.string().min(1).max(1200),
  lensFraming: z.string().max(1200).optional(),
  articleExcerpt: z.string().max(2500).optional(),
});

const factCheckSchema = z.object({
  turnId: z.string().min(1).max(200),
  transcript: z.string().min(1).max(4000),
  storyTitle: z.string().min(1).max(500),
  storyTopic: z.string().min(1).max(500),
  anchorLean: z.enum(anchorIds),
  articleContext: factCheckArticleContextSchema.optional(),
});

const anchorRuntimeOverrideSchema = z.object({
  avatarId: z.string().max(200).optional(),
  voiceId: z.string().max(200).optional(),
});

const anchorRuntimeConfigSchema = z.object({
  overrides: z.record(z.enum(anchorIds), anchorRuntimeOverrideSchema),
});

const avatarPreviewTokenSchema = z.object({
  avatarId: z.string().min(1).max(200),
  voiceId: z.string().min(1).max(200).optional(),
});

const avatarPreviewStopSchema = z.object({
  sessionId: z.string().min(1).max(200),
  sessionAccessToken: z.string().min(1).max(4000),
});

function getDemoPacket() {
  return storyPackets.find((story) => story.id === activeStoryId) ?? storyPackets[0];
}

function buildArticleProfileMap(packet: StoryPacket) {
  return buildArticleAnchorProfiles(anchorProfileMap, packet);
}

function normalizeSelectedAnchors(nextSelection?: AnchorId[], fallback: AnchorId[] = ["neutral"]): AnchorId[] {
  const base = nextSelection ?? fallback;
  const deduped = Array.from(new Set(base)).filter((anchorId): anchorId is AnchorId => anchorIds.includes(anchorId));
  return deduped.length > 0 ? deduped : ["neutral"];
}

function isSameSelection(left: AnchorId[], right: AnchorId[]) {
  return left.length === right.length && left.every((anchorId, index) => anchorId === right[index]);
}

function getSelectedAnchorsForMode(mode: SourceType) {
  return normalizeSelectedAnchors(selectedAnchorsByMode[mode], ["neutral"]);
}

function setSelectedAnchorsForMode(mode: SourceType, nextSelection?: AnchorId[]) {
  const normalized = normalizeSelectedAnchors(nextSelection, getSelectedAnchorsForMode(mode));
  selectedAnchorsByMode = {
    ...selectedAnchorsByMode,
    [mode]: normalized,
  };
  if (activeSourceMode === mode) {
    selectedAnchors = normalized;
  }
  return normalized;
}

function setActiveMode(mode: SourceType) {
  activeSourceMode = mode;
  selectedAnchors = getSelectedAnchorsForMode(mode);
}

async function syncSessionsForMode(mode: SourceType, nextSelection?: AnchorId[]) {
  const normalizedSelection = setSelectedAnchorsForMode(mode, nextSelection);

  if (mode === "article" && loadedArticlePacket) {
    return sessionManager.refreshSelectedAnchors(normalizedSelection, buildArticleProfileMap(loadedArticlePacket));
  }

  return sessionManager.syncSelectedAnchors(normalizedSelection);
}

async function syncSelectedAnchorsForCurrentMode(nextSelection: AnchorId[]) {
  return syncSessionsForMode(activeSourceMode, nextSelection);
}

async function syncSessionsForBootstrap() {
  setActiveMode(activeSourceMode);
  return syncSessionsForMode(activeSourceMode);
}

function getActivePacket(liveStoryPacket?: StoryPacket | null) {
  if (activeSourceMode === "article") {
    return loadedArticlePacket;
  }

  if (activeSourceMode === "live_feed") {
    return liveStoryPacket ?? liveSourceService.getCachedPacket();
  }

  return getDemoPacket();
}

async function resolveLivePacket() {
  return liveSourceService.getCurrent();
}

function writeNdjsonFrame(response: express.Response, frame: unknown) {
  response.write(`${JSON.stringify(frame)}\n`);
}

function resolveLlmOverride(
  llm?: { modelPreset?: "default" | "gpt-5.5"; reasoningEffort?: "low" | "medium" | "high" | "xhigh" },
): Parameters<typeof orchestratePanel>[0]["llmOverride"] {
  if (!llm || llm.modelPreset !== "gpt-5.5") {
    return undefined;
  }
  return {
    model: config.llm.openaiAdvancedModel,
    reasoningEffort: llm.reasoningEffort ?? config.llm.defaultReasoningEffort,
  };
}

async function streamOrchestrationResponse(
  response: express.Response,
  params: {
    storyPacket: StoryPacket;
    selectedAnchors: AnchorId[];
    anchorProfiles: Record<AnchorId, AnchorProfile>;
    viewerPrompt: string;
    debateConfig?: Parameters<typeof orchestratePanel>[0]["debateConfig"];
    sessionTranscript?: Parameters<typeof orchestratePanel>[0]["sessionTranscript"];
    llmOverride?: Parameters<typeof orchestratePanel>[0]["llmOverride"];
  },
) {
  response.setHeader("Content-Type", "application/x-ndjson");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  writeNdjsonFrame(response, {
    type: "session",
    storyPacket: params.storyPacket,
    sessions: sessionManager.getSessions(),
    selectedAnchors: params.selectedAnchors,
  });

  try {
    await orchestratePanel({
      selectedAnchors: params.selectedAnchors,
      viewerPrompt: params.viewerPrompt,
      storyPacket: params.storyPacket,
      anchorProfiles: params.anchorProfiles,
      sessionManager,
      liveResponseBuilder,
      factCheckProvider,
      debateConfig: params.debateConfig,
      sessionTranscript: params.sessionTranscript,
      llmOverride: params.llmOverride,
      onTurn: (turn) => {
        writeNdjsonFrame(response, { type: "turn", turn });
      },
    });
    writeNdjsonFrame(response, { type: "done" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeNdjsonFrame(response, { type: "error", message });
  } finally {
    response.end();
  }
}

async function resolvePacketForPrompt(sourceMode: SourceType): Promise<{
  storyPacket: StoryPacket | null;
  liveStatus?: LivePacketResponse;
}> {
  if (sourceMode === "article") {
    return { storyPacket: loadedArticlePacket };
  }

  if (sourceMode === "live_feed") {
    const liveStatus = await resolveLivePacket();
    return {
      storyPacket: liveStatus.storyPacket,
      liveStatus,
    };
  }

  return {
    storyPacket: getDemoPacket(),
  };
}

app.get("/api/bootstrap", async (_request, response) => {
  await syncSessionsForBootstrap();
  const liveStatus = await liveSourceService.getCurrent();

  const payload: BootstrapResponse = {
    anchors: anchorProfiles,
    anchorRuntimeStatus,
    sourceMode: activeSourceMode,
    sessions: sessionManager.getSessions(),
    selectedAnchors,
    storyPacket: getActivePacket(liveStatus.storyPacket),
    availableStories: storyPackets,
    providerMode: provider.mode,
    liveFeedEnabled: liveSourceService.isEnabled(),
    liveFeedPollMs: liveSourceService.getPollMs(),
    liveStatus,
  };

  response.json(payload);
});

app.post("/api/mode/select", async (request, response) => {
  const parsed = modeSelectionSchema.safeParse(request.body satisfies SelectModeRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  setActiveMode(parsed.data.sourceMode);
  await syncSessionsForMode(activeSourceMode);
  const liveStatus = await liveSourceService.getCurrent();

  const payload: SelectModeResponse = {
    sourceMode: activeSourceMode,
    sessions: sessionManager.getSessions(),
    selectedAnchors,
    storyPacket: getActivePacket(liveStatus.storyPacket),
    liveStatus,
  };

  response.json(payload);
});

app.get("/api/live/current", async (_request, response) => {
  const payload: LivePacketResponse = await liveSourceService.getCurrent();
  response.json(payload);
});

app.post("/api/sessions/sync", async (request, response) => {
  const parsed = selectionSchema.safeParse(request.body satisfies SyncSessionsRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  const sessions = await syncSelectedAnchorsForCurrentMode(parsed.data.selectedAnchors);
  const payload: SyncSessionsResponse = { sessions, selectedAnchors };
  response.json(payload);
});

app.post("/api/sessions/refresh", async (request, response) => {
  const parsed = refreshSessionSchema.safeParse(request.body satisfies RefreshSessionRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  const anchorId = parsed.data.anchorId;
  const session = await sessionManager.refreshAnchor(
    anchorId,
    {
      prewarmed: anchorId === "neutral",
      selected: selectedAnchors.includes(anchorId),
    },
    activeSourceMode === "article" && loadedArticlePacket
      ? buildArticleProfileMap(loadedArticlePacket)[anchorId]
      : undefined,
  );
  const payload: RefreshSessionResponse = {
    session,
    sessions: sessionManager.getSessions(),
  };
  response.json(payload);
});

app.post("/api/sessions/events", (request, response) => {
  const parsed = relaySessionEventSchema.safeParse(request.body satisfies RelaySessionEventRequest);
  if (!parsed.success) {
    const rawBody = request.body as Partial<RelaySessionEventRequest> | undefined;
    console.warn("Rejected relay event payload", {
      anchorId: rawBody?.anchorId,
      sessionId: rawBody?.sessionId,
      eventType: rawBody?.event && typeof rawBody.event === "object" && "type" in rawBody.event ? rawBody.event.type : undefined,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    response.status(400).json(parsed.error.flatten());
    return;
  }

  const payload: RelaySessionEventResponse = sessionManager.applyBrowserEvent(
    parsed.data.anchorId,
    parsed.data.sessionId,
    parsed.data.event,
  );

  if (!payload.accepted) {
    console.warn("Ignored relay event", {
      anchorId: parsed.data.anchorId,
      sessionId: parsed.data.sessionId,
      eventType: parsed.data.event.type,
      ignoredReason: payload.ignoredReason,
    });
  }
  response.json(payload);
});

app.post("/api/stories/select", (request, response) => {
  const parsed = storySelectionSchema.safeParse(request.body satisfies SelectStoryRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  const nextStory = storyPackets.find((story) => story.id === parsed.data.storyId);
  if (!nextStory) {
    response.status(404).json({ message: "Story not found" });
    return;
  }

  activeStoryId = nextStory.id;
  setActiveMode("demo_story");
  const payload: SelectStoryResponse = { storyPacket: nextStory };
  response.json(payload);
});

app.post("/api/articles/load", async (request, response) => {
  const parsed = articleLoadSchema.safeParse(request.body satisfies ArticleLoadRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  try {
    const storyPacket = await loadArticlePacket(parsed.data.url);
    const [summaryResult, suggestedPromptsResult] = await Promise.allSettled([
      liveResponseBuilder.buildArticleSummary(storyPacket, {
        id: anchorProfileMap.neutral.id,
        label: anchorProfileMap.neutral.label,
      }),
      liveResponseBuilder.buildSuggestedPrompts(storyPacket),
    ]);
    if (summaryResult.status === "fulfilled") {
      storyPacket.neutral_summary = summaryResult.value.transcript;
    }
    if (suggestedPromptsResult.status === "fulfilled" && suggestedPromptsResult.value.length > 0) {
      storyPacket.suggestedPrompts = suggestedPromptsResult.value;
    }
    const framingsResult = await liveResponseBuilder.buildArticleFramings(storyPacket).catch((error: unknown) => {
      console.warn("[articles/load] framings failed", error);
      return {} as { left?: string; right?: string };
    });
    if (framingsResult.left) {
      storyPacket.left_framing_summary = framingsResult.left;
    }
    if (framingsResult.right) {
      storyPacket.right_framing_summary = framingsResult.right;
    }
    loadedArticlePacket = storyPacket;
    setActiveMode("article");
    const sessions = await syncSessionsForMode("article");

    const payload: ArticleLoadResponse = {
      storyPacket,
      sessions,
      selectedAnchors,
    };

    response.json(payload);
  } catch (error) {
    response.status(422).json({
      message: error instanceof Error ? error.message : "Article extraction failed.",
    });
  }
});

app.post("/api/articles/ask", async (request, response) => {
  const parsed = articleAskSchema.safeParse(request.body satisfies ArticleAskRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  if (!loadedArticlePacket) {
    response.status(400).json({ message: "Load an article before asking a question." });
    return;
  }

  setActiveMode("article");
  const currentSelection = getSelectedAnchorsForMode("article");
  const nextSelection = normalizeSelectedAnchors(parsed.data.selectedAnchors, currentSelection);
  if (!isSameSelection(nextSelection, currentSelection)) {
    await syncSessionsForMode("article", nextSelection);
  } else {
    setSelectedAnchorsForMode("article", nextSelection);
  }

  await streamOrchestrationResponse(response, {
    storyPacket: loadedArticlePacket,
    selectedAnchors,
    anchorProfiles: buildArticleProfileMap(loadedArticlePacket),
    viewerPrompt: parsed.data.question,
    debateConfig: parsed.data.debateConfig,
    sessionTranscript: parsed.data.sessionTranscript,
    llmOverride: resolveLlmOverride(parsed.data.llm),
  });
});

app.post("/api/orchestrate", async (request, response) => {
  const parsed = orchestrationSchema.safeParse(request.body satisfies OrchestrateRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  const promptMode: SourceType = parsed.data.storyId ? "demo_story" : activeSourceMode;
  if (parsed.data.storyId) {
    activeStoryId = parsed.data.storyId;
    setActiveMode("demo_story");
  } else {
    setActiveMode(promptMode);
  }

  selectedAnchors = normalizeSelectedAnchors(parsed.data.selectedAnchors, getSelectedAnchorsForMode(activeSourceMode));
  setSelectedAnchorsForMode(activeSourceMode, selectedAnchors);
  await sessionManager.syncSelectedAnchors(selectedAnchors);

  const { storyPacket } = await resolvePacketForPrompt(activeSourceMode);
  if (!storyPacket) {
    response.status(409).json({
      message:
        activeSourceMode === "article"
          ? "Load an article before orchestrating the article desk."
          : "No live packet is available yet. Wait for the live feed to load or switch to demo mode.",
    });
    return;
  }

  await streamOrchestrationResponse(response, {
    storyPacket,
    selectedAnchors,
    anchorProfiles: storyPacket.sourceType === "article" ? buildArticleProfileMap(storyPacket) : anchorProfileMap,
    viewerPrompt: parsed.data.viewerPrompt,
    debateConfig: parsed.data.debateConfig,
    sessionTranscript: parsed.data.sessionTranscript,
    llmOverride: resolveLlmOverride(parsed.data.llm),
  });
});

app.post("/api/factcheck", async (request, response) => {
  const parsed = factCheckSchema.safeParse(request.body satisfies FactCheckRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  if (!factCheckProvider.available) {
    const unavailable: FactCheckResult = buildUnavailableResult(
      parsed.data.turnId,
      "GEMINI_API_KEY is not configured.",
    );
    response.json(unavailable);
    return;
  }

  try {
    const result = await factCheckProvider.factCheck(parsed.data);
    response.json(result satisfies FactCheckResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[factcheck] failed for turn ${parsed.data.turnId}: ${message}`);
    const unavailable: FactCheckResult = buildUnavailableResult(parsed.data.turnId, message);
    response.json(unavailable);
  }
});

app.post("/api/voice/turn", async (request, response) => {
  const parsed = voiceTurnSchema.safeParse(request.body satisfies VoiceTurnRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  try {
    if (parsed.data.sourceMode === "article") {
      if (!loadedArticlePacket) {
        response.status(409).json({ message: "Load an article before using voice mode." });
        return;
      }

      setActiveMode("article");
      const currentSelection = getSelectedAnchorsForMode("article");
      const nextSelection = normalizeSelectedAnchors(parsed.data.selectedAnchors, currentSelection);
      if (!isSameSelection(nextSelection, currentSelection)) {
        await syncSessionsForMode("article", nextSelection);
      } else {
        setSelectedAnchorsForMode("article", nextSelection);
      }

      await streamOrchestrationResponse(response, {
        storyPacket: loadedArticlePacket,
        selectedAnchors,
        anchorProfiles: buildArticleProfileMap(loadedArticlePacket),
        viewerPrompt: parsed.data.transcript,
        debateConfig: parsed.data.debateConfig,
        sessionTranscript: parsed.data.sessionTranscript,
        llmOverride: resolveLlmOverride(parsed.data.llm),
      });
      return;
    }

    const liveStatus = await resolveLivePacket();
    if (!liveStatus.storyPacket) {
      response.status(409).json({
        message: liveStatus.errorMessage ?? "No live packet is available yet.",
      });
      return;
    }

    setActiveMode("live_feed");
    selectedAnchors = normalizeSelectedAnchors(parsed.data.selectedAnchors, getSelectedAnchorsForMode("live_feed"));
    setSelectedAnchorsForMode("live_feed", selectedAnchors);
    await sessionManager.syncSelectedAnchors(selectedAnchors);

    await streamOrchestrationResponse(response, {
      storyPacket: liveStatus.storyPacket,
      selectedAnchors,
      anchorProfiles: anchorProfileMap,
      viewerPrompt: parsed.data.transcript,
      debateConfig: parsed.data.debateConfig,
      sessionTranscript: parsed.data.sessionTranscript,
      llmOverride: resolveLlmOverride(parsed.data.llm),
    });
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "Voice turn failed.",
    });
  }
});

app.get("/api/avatars/public", async (request, response) => {
  const apiKey = config.liveAvatar.apiKey ?? getConfiguredLiveAvatarApiKey(config.liveAvatar, "neutral");
  if (!apiKey) {
    response.status(503).json({
      message: "LiveAvatar API key not configured — set LIVEAVATAR_API_KEY (or a per-anchor key) to browse the catalog.",
    });
    return;
  }

  const page = Math.max(1, Number.parseInt((request.query.page as string) ?? "", 10) || 1);
  const requestedSize = Number.parseInt((request.query.page_size as string) ?? "", 10);
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : 24));
  const url = `${config.liveAvatar.apiUrl}/v1/avatars/public?page=${page}&page_size=${pageSize}`;

  try {
    const upstream = await fetch(url, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!upstream.ok) {
      const body = await upstream.text();
      response.status(upstream.status).json({
        message: `LiveAvatar /avatars/public failed: ${upstream.status} ${body.slice(0, 200)}`,
      });
      return;
    }
    const payload = (await upstream.json()) as { data?: PublicAvatarsResponse } | PublicAvatarsResponse;
    const data = "data" in payload && payload.data ? payload.data : (payload as PublicAvatarsResponse);
    response.json(data);
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : "Failed to reach LiveAvatar avatars endpoint.",
    });
  }
});

app.post("/api/avatars/preview-token", async (request, response) => {
  const parsed = avatarPreviewTokenSchema.safeParse(request.body satisfies AvatarPreviewTokenRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  if (provider.mode !== "full-api") {
    response.status(503).json({
      message: "Voice preview requires LIVEAVATAR_MODE=full-api with a configured API key.",
    });
    return;
  }

  // Reuse the neutral anchor's context plumbing so we don't have to create a
  // throwaway context — we override only the avatar/voice for the preview.
  const baseProfile = anchorProfileMap.neutral;
  const previewProfile: AnchorProfile = {
    ...baseProfile,
    runtime: {
      ...baseProfile.runtime,
      avatarId: parsed.data.avatarId,
      voiceId: parsed.data.voiceId,
    },
  };

  try {
    const seed = await provider.createSession(previewProfile);
    const payload: AvatarPreviewTokenResponse = {
      sessionId: seed.sessionId,
      sessionAccessToken: seed.sessionAccessToken ?? "",
      sandbox: seed.sandbox,
    };
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : "Failed to start preview session.",
    });
  }
});

app.post("/api/avatars/preview-stop", async (request, response) => {
  const parsed = avatarPreviewStopSchema.safeParse(request.body satisfies AvatarPreviewStopRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  if (provider.mode !== "full-api") {
    response.status(200).json({ ok: true } satisfies AvatarPreviewStopResponse);
    return;
  }

  // Stop the LiveAvatar session directly — the provider's stopSession only
  // needs the access token, but its public signature wants a full
  // AnchorSession so we synthesize a minimal one.
  const stub: AnchorSession = {
    anchorId: "neutral",
    sessionId: parsed.data.sessionId,
    status: "ready",
    providerMode: "full-api",
    prewarmed: false,
    lazy: false,
    transcript: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sandbox: config.liveAvatar.sandbox,
    isSelected: false,
    sessionAccessToken: parsed.data.sessionAccessToken,
    liveReady: false,
  };
  await provider.stopSession(stub).catch(() => undefined);
  response.json({ ok: true } satisfies AvatarPreviewStopResponse);
});

app.post("/api/anchors/runtime-config", async (request, response) => {
  const parsed = anchorRuntimeConfigSchema.safeParse(request.body satisfies AnchorRuntimeConfigRequest);
  if (!parsed.success) {
    response.status(400).json(parsed.error.flatten());
    return;
  }

  const changedAnchors = sessionManager.applyRuntimeOverrides(parsed.data.overrides);

  // Selected anchors: refresh now so the new avatar shows immediately on the
  // pre-warmed feed. Non-selected anchors: invalidate the stale session (built
  // with the old avatar) so the next select-and-ensure mints a fresh one
  // against the new profile. Without this, syncFullApiSelection would
  // short-circuit on the existing token and keep the old avatar playing.
  for (const anchorId of changedAnchors) {
    if (selectedAnchors.includes(anchorId)) {
      await sessionManager.refreshAnchor(
        anchorId,
        {
          prewarmed: anchorId === "neutral",
          selected: true,
        },
        activeSourceMode === "article" && loadedArticlePacket
          ? buildArticleProfileMap(loadedArticlePacket)[anchorId]
          : undefined,
      );
    } else {
      await sessionManager.invalidateSession(anchorId);
    }
  }

  const payload: AnchorRuntimeConfigResponse = {
    anchors: anchorProfiles,
    sessions: sessionManager.getSessions(),
    changedAnchors,
  };
  response.json(payload);
});

const hyperframesDir = join(projectRoot, "hyperframes");

// Per-mount variable injection for the live ticker. The Player web component
// cannot pass variables to the iframe, and the bundle-mode variable system is
// flaky, so we intercept this specific composition request and write the
// caller's items/accent/label onto the host element's `data-variable-values`.
// The ticker sub-comp's defensive resolver already reads that attribute, so
// no template change is needed — and the highlight reel keeps using the same
// composition unmodified.
app.get("/hyperframes/players/live-ticker.html", (request, response) => {
  const filePath = join(hyperframesDir, "players", "live-ticker.html");
  if (!existsSyncFs(filePath)) {
    response.status(404).send("live-ticker not found");
    return;
  }
  const items = typeof request.query.items === "string" ? request.query.items : "";
  const accent = typeof request.query.accent === "string" ? request.query.accent : "";
  const label = typeof request.query.label === "string" ? request.query.label : "";
  const speed = typeof request.query.speed === "string" ? request.query.speed : "";
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  if (!items && !accent && !label && !speed) {
    response.send(readFileSync(filePath, "utf8"));
    return;
  }
  const vars: Record<string, string | number> = {};
  if (items) vars.items = items;
  if (accent) vars.accent = accent;
  if (label) vars.label = label;
  if (speed) {
    const n = Number(speed);
    if (Number.isFinite(n) && n > 0) vars.speedSeconds = n;
  }
  // Embed as an HTML-safe attribute. Browsers parse single-quoted attributes
  // fine; our JSON contains no single quotes (we stringify with default).
  const attr = `data-variable-values='${JSON.stringify(vars).replace(/'/g, "&apos;")}'`;
  const html = readFileSync(filePath, "utf8").replace(
    /(<div\s+id="el-ticker")/,
    `$1 ${attr}`,
  );
  response.send(html);
});

if (existsSync(hyperframesDir)) {
  app.use(
    "/hyperframes",
    express.static(hyperframesDir, {
      setHeaders: (response) => {
        response.setHeader("Cache-Control", "no-store");
      },
    }),
  );
}

// Newsroom HUD contextual content (Gemini-backed). Accepts a StoryPacket and
// returns ticker headlines + a BREAKING headline shaped for broadcast.
// Cached server-side by storyPacket.id with a 30-minute TTL. The Gemini call
// is cheap (one flash-tier round trip) and only fires once per story.
const hudContextSchema = z.object({
  storyPacket: z.unknown(),
  force: z.boolean().optional(),
  round: z
    .object({
      roundIndex: z.number().int().min(0),
      turns: z
        .array(
          z.object({
            anchorLabel: z.string(),
            anchorLean: z.string().optional(),
            transcript: z.string(),
          }),
        )
        .min(1),
    })
    .optional(),
});

app.post("/api/hud/contextual", async (request, response) => {
  const parsed = hudContextSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "BAD_BODY", details: parsed.error.flatten() });
    return;
  }
  const packet = parsed.data.storyPacket as StoryPacket | null | undefined;
  if (!packet || typeof packet !== "object" || !("id" in packet) || !packet.id) {
    response.status(400).json({ error: "MISSING_STORY_PACKET" });
    return;
  }
  try {
    const { context, source } = await buildHudContext(packet, config.llm, {
      force: parsed.data.force === true,
      round: parsed.data.round,
    });
    response.json({
      context,
      source,
      storyId: packet.id,
      roundIndex: parsed.data.round?.roundIndex ?? null,
    });
  } catch (err) {
    console.warn("[hud/contextual] failed", err);
    response.status(500).json({ error: "HUD_CONTEXT_FAILED" });
  }
});

// ── Highlight reel (Act 2) ─────────────────────────────────────────────
const cacheDir = join(projectRoot, "server", "cache");
const clipsRoot = join(cacheDir, "clips");
const reelsRoot = join(cacheDir, "reels");
mkdirSync(clipsRoot, { recursive: true });
mkdirSync(reelsRoot, { recursive: true });

// Serve uploaded clips so the Hyperframes composition can <video src=…> them.
app.use("/highlight-clips", express.static(clipsRoot, { setHeaders: (r) => r.setHeader("Cache-Control", "no-store") }));
app.use("/highlight-reels", express.static(reelsRoot, { setHeaders: (r) => r.setHeader("Cache-Control", "no-store") }));

// POST /api/highlights/clip/:sessionId/:turnId  — body: raw webm bytes
app.post(
  "/api/highlights/clip/:sessionId/:turnId",
  express.raw({ type: "*/*", limit: "200mb" }),
  (request, response) => {
    const sessionId = String(request.params.sessionId).replace(/[^a-zA-Z0-9_-]/g, "");
    const turnId = String(request.params.turnId).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sessionId || !turnId) {
      response.status(400).json({ error: "BAD_PARAMS" });
      return;
    }
    const body = request.body as Buffer | undefined;
    if (!body || body.length === 0) {
      response.status(400).json({ error: "EMPTY_BODY" });
      return;
    }
    const sessionDir = join(clipsRoot, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const filePath = join(sessionDir, `${turnId}.webm`);
    writeFileSync(filePath, body);
    response.json({ ok: true, turnId, bytes: body.length });
  },
);

const highlightRenderSchema = z.object({
  sessionId: z.string().min(1).max(100),
  story: z.unknown().nullable(),
  turns: z.array(z.unknown()),
  limit: z.number().int().min(1).max(12).optional(),
});

// POST /api/highlights/render  — produces the MP4 from uploaded clips
app.post("/api/highlights/render", async (request, response) => {
  const parsed = highlightRenderSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "INVALID_PAYLOAD", details: parsed.error.format() });
    return;
  }
  const { sessionId, story, turns, limit } = parsed.data;
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeSessionId) {
    response.status(400).json({ error: "BAD_SESSION_ID" });
    return;
  }

  // Build the URL map for clips that have actually been uploaded.
  const sessionClipsDir = join(clipsRoot, safeSessionId);
  const clipUrls: Record<string, string> = {};
  if (existsSyncFs(sessionClipsDir)) {
    for (const turn of turns as Array<{ turnId?: string }>) {
      const tid = String(turn?.turnId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
      if (!tid) continue;
      const fp = join(sessionClipsDir, `${tid}.webm`);
      if (existsSyncFs(fp)) {
        clipUrls[tid] = `http://127.0.0.1:${port}/highlight-clips/${safeSessionId}/${tid}.webm`;
      }
    }
  }

  const manifest = buildHighlightManifest({
    sessionId: safeSessionId,
    story: (story as StoryPacket | null) ?? null,
    turns: turns as PanelTurn[],
    anchorProfiles,
    clipUrls,
    limit,
  });

  if (manifest.clips.length === 0) {
    response.status(409).json({ error: "NO_CLIPS_RECORDED" });
    return;
  }

  const outPath = join(reelsRoot, `${safeSessionId}.mp4`);
  try {
    const result = await renderHighlight({
      manifest,
      projectDir: hyperframesDir,
      composition: "players/highlight-reel.html",
      outPath,
    });
    const payload = {
      ok: true,
      sessionId: safeSessionId,
      manifestPath: result.manifestPath,
      mp4Url: `/highlight-reels/${safeSessionId}.mp4`,
      durationSec: result.durationSec,
      renderMs: result.renderMs,
    };
    response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[highlights] render failed:", message);
    response.status(500).json({ error: "RENDER_FAILED", message });
  }
});

// Silence unused
void statSync;

if (existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      setHeaders: (response, path) => {
        if (path.endsWith("index.html")) {
          response.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
  app.get("/{*path}", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(join(distDir, "index.html"));
  });
}

app.listen(port, config.host, () => {
  console.log(`Live Avatar Election Desk server listening on http://${config.host}:${port}`);
});
