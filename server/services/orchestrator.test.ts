import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorId, AnchorProfile } from "../../shared/models";
import { anchorProfiles } from "../data/anchors";
import { storyPackets } from "../data/stories";
import { MockLiveAvatarProvider } from "./liveavatar/mockLiveAvatarProvider";
import { orchestratePanel, getSpeakingOrder, inferResponseGoal, shuffleSpeakingOrder } from "./orchestrator";
import { AnchorSessionManager } from "../state/sessionManager";
import { LiveResponseBuilder } from "./liveResponse";

function buildProfileMap() {
  return Object.fromEntries(anchorProfiles.map((profile) => [profile.id, profile])) as Record<
    AnchorId,
    AnchorProfile
  >;
}

describe("orchestrator", () => {
  // Round 1 of orchestratePanel uses Math.random to shuffle the speaking order.
  // Pinning Math.random to ~1 makes fisherYates a no-op so transcript-carryover
  // assertions stay deterministic; the shuffle itself is tested separately below.
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts Neutral Desk first whenever neutral is selected", () => {
    expect(getSpeakingOrder(["right", "neutral", "left"])).toEqual(["neutral", "left", "right"]);
  });

  it("moves the chosen opening speaker to the front when explicitly set", () => {
    expect(getSpeakingOrder(["right", "neutral", "left"], "left")).toEqual(["left", "neutral", "right"]);
  });

  it("keeps left then right order when neutral is absent", () => {
    expect(getSpeakingOrder(["right", "left"])).toEqual(["left", "right"]);
  });

  it("maps common viewer prompts to response goals", () => {
    expect(inferResponseGoal("What changed?")).toBe("latest_change");
    expect(inferResponseGoal("How is the left covering this?")).toBe("left_view");
    expect(inferResponseGoal("Respond to what the other anchor said.")).toBe("anchor_reply");
    expect(inferResponseGoal("How do left and right differ on healthcare?")).toBe("compare");
  });

  it("passes prior anchor output forward so the next anchor replies to it", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left"]);

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left"],
      viewerPrompt: "Show me both sides.",
      storyPacket: storyPackets[0],
      anchorProfiles: buildProfileMap(),
      sessionManager,
    });

    expect(turns).toHaveLength(2);
    expect(turns[0].anchorId).toBe("neutral");
    expect(turns[1].anchorId).toBe("left");
    expect(turns[0].generationSource).toBe("template_fallback");
    expect(turns[1].priorAnchorId).toBe("neutral");
    expect(turns[1].sourceExcerpt).toContain("current cross-channel picture");
    expect(turns[1].transcript).toContain("Left Lens to Neutral Desk:");
    expect(turns[1].citedEvidence.length).toBeGreaterThan(0);
  });

  it("uses the live response builder for article turns when available", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();

    const buildArticleTurn = vi.fn().mockResolvedValue({
      transcript: "The loaded article says the contest narrowed after the debate.",
      citedEvidence: [storyPackets[0].source_evidence[0]],
      generationSource: "openai" as const,
    });

    const liveResponseBuilder = {
      buildArticleTurn,
    } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral"],
      viewerPrompt: "Who wrote this article?",
      storyPacket: {
        ...storyPackets[0],
        id: "article-demo",
        sourceType: "article",
        title: "Article demo",
        sourceByline: "Jordan Hale",
        articleSnippets: ["The report credits Jordan Hale with the byline."],
        articleBody: "The report credits Jordan Hale with the byline.",
        source_evidence: [
          {
            channel: "Metro Chronicle",
            lean: "neutral",
            timestamp: "2026-04-09T10:30:00Z",
            note: "The report credits Jordan Hale with the byline.",
          },
        ],
      },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].anchorId).toBe("neutral");
    expect(turns[0].transcript).toContain("contest narrowed");
    expect(turns[0].generationSource).toBe("openai");
    expect(turns[0].citedEvidence).toHaveLength(1);
    expect(buildArticleTurn).toHaveBeenCalledTimes(1);
  });

  it("forwards the llmOverride to the article builder", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();

    const buildArticleTurn = vi.fn().mockResolvedValue({
      transcript: "An advanced model answers the article question.",
      citedEvidence: [storyPackets[0].source_evidence[0]],
      generationSource: "openai" as const,
    });

    const liveResponseBuilder = {
      buildArticleTurn,
    } as unknown as LiveResponseBuilder;

    await orchestratePanel({
      selectedAnchors: ["neutral"],
      viewerPrompt: "Who wrote this article?",
      storyPacket: {
        ...storyPackets[0],
        id: "article-demo-override",
        sourceType: "article",
        title: "Article demo",
        sourceByline: "Jordan Hale",
        articleSnippets: ["The report credits Jordan Hale with the byline."],
        articleBody: "The report credits Jordan Hale with the byline.",
        source_evidence: [
          {
            channel: "Metro Chronicle",
            lean: "neutral",
            timestamp: "2026-04-09T10:30:00Z",
            note: "The report credits Jordan Hale with the byline.",
          },
        ],
      },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      llmOverride: { model: "gpt-5.5", reasoningEffort: "high" },
    });

    expect(buildArticleTurn).toHaveBeenCalledTimes(1);
    const overrideArg = buildArticleTurn.mock.calls[0][5];
    expect(overrideArg).toEqual({ model: "gpt-5.5", reasoningEffort: "high" });
  });

  it("falls back to deterministic article answers when provider generation fails", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();

    const liveResponseBuilder = {
      buildArticleTurn: vi.fn().mockRejectedValue(new Error("provider failed")),
    } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral"],
      viewerPrompt: "Who wrote this article?",
      storyPacket: {
        ...storyPackets[0],
        id: "article-demo",
        sourceType: "article",
        title: "Article demo",
        sourceByline: "Jordan Hale",
        articleSnippets: ["The report credits Jordan Hale with the byline."],
        articleBody: "The report credits Jordan Hale with the byline.",
        source_evidence: [
          {
            channel: "Metro Chronicle",
            lean: "neutral",
            timestamp: "2026-04-09T10:30:00Z",
            note: "The report credits Jordan Hale with the byline.",
          },
        ],
      },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].anchorId).toBe("neutral");
    expect(turns[0].transcript).toContain("Jordan Hale");
    expect(turns[0].generationSource).toBe("article");
    expect(turns[0].citedEvidence).toHaveLength(1);
  });

  it("supports multi-anchor article debate turns with transcript carryover", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left"]);

    const buildArticleTurn = vi
      .fn()
      .mockImplementationOnce(async () => ({
        transcript: "Left Lens opens with an article-grounded critique.",
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
      }))
      .mockImplementationOnce(async (_anchor, _packet, _viewerPrompt, _responseGoal, context) => ({
        transcript: `Neutral Desk replies to ${context?.priorTranscriptExcerpts[0]?.anchorId}.`,
        citedEvidence: [storyPackets[0].source_evidence[2]],
        generationSource: "openai" as const,
      }));

    const liveResponseBuilder = {
      buildArticleTurn,
    } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left"],
      viewerPrompt: "Debate the article.",
      storyPacket: {
        ...storyPackets[0],
        id: "article-demo-multi",
        sourceType: "article",
        title: "Article demo",
        sourceByline: "Jordan Hale",
        articleSnippets: ["The report credits Jordan Hale with the byline."],
        articleBody: "The report credits Jordan Hale with the byline.",
        source_evidence: [
          {
            channel: "Metro Chronicle",
            lean: "left",
            timestamp: "2026-04-09T10:30:00Z",
            note: "The report credits Jordan Hale with the byline.",
          },
          {
            channel: "Metro Chronicle",
            lean: "neutral",
            timestamp: "2026-04-09T10:31:00Z",
            note: "Neutral follow-up evidence.",
          },
          {
            channel: "Metro Chronicle",
            lean: "neutral",
            timestamp: "2026-04-09T10:32:00Z",
            note: "Second neutral follow-up evidence.",
          },
        ],
      },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      debateConfig: {
        openingSpeaker: "left",
      },
    });

    expect(turns).toHaveLength(2);
    expect(turns[0].anchorId).toBe("left");
    expect(turns[1].anchorId).toBe("neutral");
    expect(turns[1].priorAnchorId).toBe("left");
    expect(buildArticleTurn.mock.calls[1][4]?.priorTranscriptExcerpts[0]?.text).toBe(turns[0].transcript);
  });

  it("uses the live response builder for live feed turns and passes prior transcripts forward", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left"]);

    const buildTurn = vi
      .fn()
      .mockImplementationOnce(async () => ({
        transcript: "Neutral generated turn grounded in the live packet.",
        citedEvidence: [storyPackets[0].source_evidence[2]],
        generationSource: "openai" as const,
      }))
      .mockImplementationOnce(async (_anchor, packet) => ({
        transcript: `Replying to ${packet.priorTranscriptExcerpts[0]?.anchorId}, left framing generated from the live packet.`,
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
      }));

    const liveResponseBuilder = {
      buildTurn,
    } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left"],
      viewerPrompt: "Show me both sides.",
      storyPacket: {
        ...storyPackets[0],
        sourceType: "live_feed",
      },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
    });

    expect(turns).toHaveLength(2);
    expect(turns[0].generationSource).toBe("openai");
    expect(turns[0].citedEvidence).toEqual([storyPackets[0].source_evidence[2]]);
    expect(turns[1].generationSource).toBe("openai");
    expect(turns[1].transcript).toContain("neutral");
    expect(buildTurn).toHaveBeenCalledTimes(2);
    expect(buildTurn.mock.calls[1][1].priorTranscriptExcerpts[0]?.text).toBe(turns[0].transcript);
  });

  it("falls back to deterministic templates when live feed generation fails", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();

    const liveResponseBuilder = {
      buildTurn: vi.fn().mockRejectedValue(new Error("provider failed")),
    } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral"],
      viewerPrompt: "What changed?",
      storyPacket: {
        ...storyPackets[2],
        sourceType: "live_feed",
      },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].generationSource).toBe("template_fallback");
    expect(turns[0].transcript.toLowerCase()).toContain("what changed");
    expect(turns[0].citedEvidence.length).toBeGreaterThan(0);
  });

  it("runs multi-round debate with a moderator beat when three anchors and debateRounds > 1", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left", "right"]);

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left", "right"],
      viewerPrompt: "Show me both sides.",
      storyPacket: storyPackets[0],
      anchorProfiles: buildProfileMap(),
      sessionManager,
      debateConfig: { debateRounds: 2, includeModeratorBeat: true },
    });

    // 3 anchors × 2 rounds + 2 moderator beats (one per round) = 8 turns.
    expect(turns.length).toBe(8);
    expect(turns[0].roundIndex).toBe(0);
    expect(turns[3].isModeratorBeat).toBe(true);
    expect(turns[3].anchorId).toBe("neutral");
    expect(turns[3].responseGoal).toBe("compare");
    // No self-replies anywhere.
    for (const turn of turns) {
      expect(turn.replyToAnchorId).not.toBe(turn.anchorId);
    }
  });

  it("passes the full per-anchor peer transcript history forward (no cross-round window cap)", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left"]);

    const buildTurn = vi.fn().mockImplementation(async (_anchor, _packet) => ({
      transcript: `Turn for ${_anchor.id}.`,
      citedEvidence: [storyPackets[0].source_evidence[0]],
      generationSource: "openai" as const,
    }));
    const liveResponseBuilder = { buildTurn } as unknown as LiveResponseBuilder;

    await orchestratePanel({
      selectedAnchors: ["neutral", "left"],
      viewerPrompt: "Debate.",
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      debateConfig: { debateRounds: 2, includeModeratorBeat: false },
    });

    // Round 0 turn 0: 0 prior. Round 0 turn 1: 1 prior (neutral).
    // Round 1 turn 0 (neutral): 1 prior (left from round 0 — self-filtered).
    // Round 1 turn 1 (left): 2 priors (both neutral turns — self-filtered, no cap).
    const priorCounts = buildTurn.mock.calls.map(([, packet]) => packet.priorTranscriptExcerpts.length);
    expect(priorCounts).toEqual([0, 1, 1, 2]);
  });

  it("breaks out of the round loop with a closing segue when ≥50% of a round's turns yield", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left", "right"]);

    // Round 0: neutral speaks substantively; left and right both yield. 2/3 yields → exhausted.
    const closingDirectives: (string | undefined)[] = [];
    const buildTurn = vi
      .fn()
      .mockImplementationOnce(async (_anchor, _packet) => ({
        transcript: "Neutral opens with a fresh framing.",
        citedEvidence: [storyPackets[0].source_evidence[2]],
        generationSource: "openai" as const,
      }))
      .mockImplementationOnce(async (_anchor, _packet) => ({
        transcript: "I'll let Avery take this — covered the core.",
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
        yield: { reason: "no fresh structural angle available" },
      }))
      .mockImplementationOnce(async (_anchor, _packet) => ({
        transcript: "Avery has it — no new accountability angle here.",
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
        yield: { reason: "no fresh incentive angle available" },
      }))
      .mockImplementation(async (_anchor, packet) => {
        // Subsequent calls are the moderator's closing segue — capture its closingDirective.
        closingDirectives.push(packet.closingDirective);
        return {
          transcript: "That looks like the read — anything else worth pulling on here?",
          citedEvidence: [storyPackets[0].source_evidence[2]],
          generationSource: "openai" as const,
        };
      });

    const liveResponseBuilder = { buildTurn } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left", "right"],
      viewerPrompt: "Debate.",
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      // Cap is 2 rounds — exhaustion in round 0 should prevent round 1 from running.
      debateConfig: { debateRounds: 2, includeModeratorBeat: true },
    });

    // 3 anchor turns in round 0 + 1 moderator closing segue. No round 1 turns at all.
    expect(turns).toHaveLength(4);
    expect(turns.filter((t) => t.roundIndex === 1)).toHaveLength(0);
    const segue = turns[3];
    expect(segue.isModeratorBeat).toBe(true);
    expect(segue.anchorId).toBe("neutral");
    expect(closingDirectives[0]).toBeDefined();
    expect(closingDirectives[0]).toContain("converged");
  });

  it("ends silently with no segue on exhaustion when neutral is not selected", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["left", "right"]);

    const buildTurn = vi
      .fn()
      .mockImplementationOnce(async () => ({
        transcript: "Left opens.",
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
      }))
      .mockImplementationOnce(async () => ({
        transcript: "Right yields cleanly.",
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
        yield: { reason: "covered" },
      }));

    const liveResponseBuilder = { buildTurn } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["left", "right"],
      viewerPrompt: "Debate.",
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      debateConfig: { debateRounds: 2, includeModeratorBeat: true },
    });

    // 1/2 yields = exhausted. No segue (no neutral). No round 1.
    expect(turns).toHaveLength(2);
    expect(turns.some((t) => t.isModeratorBeat)).toBe(false);
  });

  it("shuffleSpeakingOrder returns a permutation and honors a pinned opening speaker", () => {
    // Restore real Math.random for this test so we actually exercise the shuffle.
    vi.restoreAllMocks();
    const sample = ["neutral", "left", "right"] as const satisfies readonly AnchorId[];
    for (let trial = 0; trial < 20; trial++) {
      const shuffled = shuffleSpeakingOrder([...sample]);
      expect([...shuffled].sort()).toEqual([...sample].sort());
    }
    // With a pinned opening speaker, that anchor stays first; the rest may shuffle.
    for (let trial = 0; trial < 20; trial++) {
      const shuffled = shuffleSpeakingOrder([...sample], "right");
      expect(shuffled[0]).toBe("right");
      expect([...shuffled].sort()).toEqual([...sample].sort());
    }
  });

  it("invokes onTurn for each turn in order before resolving", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left", "right"]);

    const seenAnchors: string[] = [];
    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left", "right"],
      viewerPrompt: "Compare the sides.",
      storyPacket: storyPackets[0],
      anchorProfiles: buildProfileMap(),
      sessionManager,
      onTurn: (turn) => {
        seenAnchors.push(turn.anchorId);
      },
    });

    expect(seenAnchors).toEqual(turns.map((t) => t.anchorId));
    expect(seenAnchors.length).toBe(turns.length);
  });

  it("speaks yielded turns but excludes them from subsequent priorTranscriptExcerpts", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left"]);

    const buildTurn = vi
      .fn()
      .mockImplementationOnce(async () => ({
        transcript: "Neutral leads with the latest read.",
        citedEvidence: [storyPackets[0].source_evidence[0]],
        generationSource: "openai" as const,
      }))
      .mockImplementationOnce(async () => ({
        transcript: "I'll let Avery take this — already covered.",
        citedEvidence: [],
        generationSource: "openai" as const,
        yield: { reason: "No new framing to add." },
      }));

    const liveResponseBuilder = { buildTurn } as unknown as LiveResponseBuilder;

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral", "left"],
      viewerPrompt: "Debate it.",
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      debateConfig: { debateRounds: 2, includeModeratorBeat: false },
    });

    const leftTurn = turns.find((turn) => turn.anchorId === "left");
    expect(leftTurn?.yielded).toBe(true);
    expect(leftTurn?.yieldReason).toBe("No new framing to add.");

    // Round 1 (index 0) priors should include neutral but NOT the yielded left turn.
    const round1NeutralCall = buildTurn.mock.calls.find(
      ([anchor, packet]) => anchor.id === "neutral" && packet.priorTranscriptExcerpts.length > 0,
    );
    if (round1NeutralCall) {
      const priorAnchors = round1NeutralCall[1].priorTranscriptExcerpts.map((excerpt: { anchorId: string }) => excerpt.anchorId);
      expect(priorAnchors).not.toContain("left");
    }
  });

  it("fires fact-check in parallel with TTS and embeds the grounded result on the turn", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral"]);

    const buildTurn = vi.fn().mockResolvedValue({
      transcript: "Neutral states the latest factual claim.",
      citedEvidence: [storyPackets[0].source_evidence[0]],
      generationSource: "openai" as const,
    });
    const liveResponseBuilder = { buildTurn } as unknown as LiveResponseBuilder;

    const factCheck = vi.fn().mockResolvedValue({
      turnId: "tbd",
      confidence: 88,
      mode: "grounded" as const,
      claims: [
        {
          text: "The latest factual claim",
          verdict: "verified" as const,
          rationale: "Reuters confirms.",
          sources: [{ outlet: "Reuters", url: "https://reuters.com/x" }],
        },
      ],
      generatedAt: "2026-05-15T00:00:00Z",
    });

    const turns = await orchestratePanel({
      selectedAnchors: ["neutral"],
      viewerPrompt: "What changed?",
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      factCheckProvider: { available: true, factCheck },
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].factCheck?.mode).toBe("grounded");
    expect(turns[0].factCheck?.claims[0].verdict).toBe("verified");
    expect(factCheck).toHaveBeenCalledTimes(1);
  });

  it("passes priorFactChecks into the panel packet for subsequent anchors (peer-only)", async () => {
    const sessionManager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
    await sessionManager.initialize();
    await sessionManager.syncSelectedAnchors(["neutral", "left"]);

    const buildTurn = vi.fn().mockImplementation(async (anchor) => ({
      transcript: `${anchor.label} says something factual.`,
      citedEvidence: [storyPackets[0].source_evidence[0]],
      generationSource: "openai" as const,
    }));
    const liveResponseBuilder = { buildTurn } as unknown as LiveResponseBuilder;

    const factCheck = vi.fn().mockImplementation(async (req: { turnId: string; anchorLean: AnchorId }) => ({
      turnId: req.turnId,
      confidence: 80,
      mode: "grounded" as const,
      claims: [
        {
          text: `claim from ${req.anchorLean}`,
          verdict: "verified" as const,
          rationale: "sources line up",
          sources: [{ outlet: "Reuters", url: "https://reuters.com/x" }],
        },
      ],
      generatedAt: "2026-05-15T00:00:00Z",
    }));

    await orchestratePanel({
      selectedAnchors: ["neutral", "left"],
      viewerPrompt: "Compare.",
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      anchorProfiles: buildProfileMap(),
      sessionManager,
      liveResponseBuilder,
      factCheckProvider: { available: true, factCheck },
    });

    // Second call (left) should have neutral's fact-check in priorFactChecks, but NOT left's own.
    const leftCall = buildTurn.mock.calls.find(([anchor]) => anchor.id === "left");
    expect(leftCall).toBeDefined();
    const leftPriorFactChecks = leftCall![1].priorFactChecks;
    expect(leftPriorFactChecks?.length).toBe(1);
    expect(leftPriorFactChecks?.[0].anchorId).toBe("neutral");
  });
});
