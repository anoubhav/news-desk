import { describe, expect, it } from "vitest";
import { anchorProfiles } from "../../data/anchors";
import { storyPackets } from "../../data/stories";
import { LiveResponseBuilder, buildLiveSystemPrompt, buildArticleSystemPrompt } from "./builder";
import type { LiveResponseProvider } from "./provider";

function buildProvider(result: {
  transcript: string;
  citedEvidenceIndexes: number[];
  yield?: { reason: string };
}): LiveResponseProvider {
  return {
    name: "openai",
    available: true,
    async generateTurn() {
      return result;
    },
  };
}

describe("LiveResponseBuilder", () => {
  it("maps valid evidence indexes and discards invalid or duplicate ones", async () => {
    const builder = new LiveResponseBuilder(
      buildProvider({
        transcript: "Neutral generated turn.",
        citedEvidenceIndexes: [2, 99, 2, -1, 0],
      }),
    );

    const turn = await builder.buildTurn(anchorProfiles[0], {
      storyPacket: {
        ...storyPackets[0],
        sourceType: "live_feed",
      },
      selectedAnchors: ["neutral", "left"],
      speakingOrder: ["neutral", "left"],
      priorTranscriptExcerpts: [],
      responseGoal: "compare",
      debateConfig: {
        tone: "balanced",
        openingSpeaker: "auto",
        debateRounds: 1,
        includeModeratorBeat: true,
      },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.82,
    });

    expect(turn.generationSource).toBe("openai");
    expect(turn.citedEvidence).toEqual([storyPackets[0].source_evidence[2], storyPackets[0].source_evidence[0]]);
  });

  it("builds provider-backed article summaries with mapped citations", async () => {
    const builder = new LiveResponseBuilder(
      buildProvider({
        transcript: "A late poll narrowed the Senate race after the debate, with turnout strategy now central.",
        citedEvidenceIndexes: [1, 0, 99, 1],
      }),
    );

    const turn = await builder.buildArticleSummary({
      ...storyPackets[0],
      sourceType: "article",
      sourceUrl: "https://example.com/politics/senate-race-tightens",
      sourceTitle: "Senate race tightens after debate",
      sourceByline: "Jordan Hale",
      sourcePublishedAt: "2026-04-09T10:30:00Z",
      articleBody: "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
      articleSnippets: [
        "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
        "Campaign aides pointed to suburban counties, fundraising, and ad reservation changes as the next pressure points.",
      ],
    });

    expect(turn.generationSource).toBe("openai");
    expect(turn.transcript).toBe("A late poll narrowed the Senate race after the debate, with turnout strategy now central.");
    expect(turn.citedEvidence).toEqual([storyPackets[0].source_evidence[1], storyPackets[0].source_evidence[0]]);
  });

  it("builds provider-backed article Q&A turns with mapped citations", async () => {
    const builder = new LiveResponseBuilder(
      buildProvider({
        transcript: "Based on the loaded article, the debate fallout tightened the race.",
        citedEvidenceIndexes: [2, 0, 2, -1],
      }),
    );

    const turn = await builder.buildArticleTurn(
      anchorProfiles[0],
      {
        ...storyPackets[0],
        sourceType: "article",
        sourceUrl: "https://example.com/politics/senate-race-tightens",
        sourceTitle: "Senate race tightens after debate",
        sourceByline: "Jordan Hale",
        sourcePublishedAt: "2026-04-09T10:30:00Z",
        articleBody: "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
        articleSnippets: [
          "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
          "Campaign aides pointed to suburban counties, fundraising, and ad reservation changes as the next pressure points.",
        ],
      },
      "What changed?",
      "latest_change",
    );

    expect(turn.generationSource).toBe("openai");
    expect(turn.transcript).toContain("debate fallout tightened the race");
    expect(turn.citedEvidence).toEqual([storyPackets[0].source_evidence[2], storyPackets[0].source_evidence[0]]);
  });

  it("builds provider-backed article turns for non-neutral anchors with conversation context", async () => {
    const builder = new LiveResponseBuilder(
      buildProvider({
        transcript: "From the article, the left lens emphasizes who absorbs the fallout.",
        citedEvidenceIndexes: [1],
      }),
    );

    const turn = await builder.buildArticleTurn(
      anchorProfiles[1],
      {
        ...storyPackets[0],
        sourceType: "article",
        sourceUrl: "https://example.com/politics/senate-race-tightens",
        sourceTitle: "Senate race tightens after debate",
        sourceByline: "Jordan Hale",
        sourcePublishedAt: "2026-04-09T10:30:00Z",
        articleBody: "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
        articleSnippets: [
          "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
          "Campaign aides pointed to suburban counties, fundraising, and ad reservation changes as the next pressure points.",
        ],
      },
      "Debate the article.",
      "compare",
      {
        selectedAnchors: ["left", "neutral"],
        speakingOrder: ["left", "neutral"],
        priorTranscriptExcerpts: [],
        debateConfig: {
          tone: "aggressive",
          openingSpeaker: "left",
          debateRounds: 1,
          includeModeratorBeat: true,
        },
      },
    );

    expect(turn.generationSource).toBe("openai");
    expect(turn.transcript).toContain("left lens emphasizes");
    expect(turn.citedEvidence).toEqual([storyPackets[0].source_evidence[1]]);
  });
});

describe("prompt construction", () => {
  it("includes the PRIOR TURNS and FRESH-ANGLE REPLY RULE blocks in the live system prompt when prior excerpts exist", async () => {
    const prompt = buildLiveSystemPrompt(anchorProfiles[1], {
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      selectedAnchors: ["neutral", "left"],
      speakingOrder: ["neutral", "left"],
      priorTranscriptExcerpts: [
        { anchorId: "neutral", text: "Neutral set the consensus that turnout is the swing variable." },
      ],
      responseGoal: "compare",
      debateConfig: { tone: "balanced", openingSpeaker: "auto", debateRounds: 1, includeModeratorBeat: true },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.82,
    });

    expect(prompt).toContain("PRIOR TURNS IN THIS PANEL");
    expect(prompt).toContain("Avery Quinn");
    expect(prompt).toContain("FRESH-ANGLE REPLY RULE");
  });

  it("omits the PRIOR TURNS block in the live system prompt when there are no prior excerpts", () => {
    const prompt = buildLiveSystemPrompt(anchorProfiles[0], {
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      selectedAnchors: ["neutral"],
      speakingOrder: ["neutral"],
      priorTranscriptExcerpts: [],
      responseGoal: "latest_change",
      debateConfig: { tone: "balanced", openingSpeaker: "auto", debateRounds: 1, includeModeratorBeat: true },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.9,
    });

    expect(prompt).not.toContain("PRIOR TURNS IN THIS PANEL");
    expect(prompt).not.toContain("FRESH-ANGLE REPLY RULE");
  });

  it("includes the PRIOR TURNS block in the article system prompt when prior excerpts exist", () => {
    const prompt = buildArticleSystemPrompt(
      anchorProfiles[2],
      { ...storyPackets[0], sourceType: "article" },
      "compare",
      { tone: "balanced", openingSpeaker: "auto", debateRounds: 1, includeModeratorBeat: true },
      [{ anchorId: "left", text: "Left framed it as accountability for institutions." }],
    );

    expect(prompt).toContain("PRIOR TURNS IN THIS PANEL");
    expect(prompt).toContain("Maya Reyes");
    expect(prompt).toContain("FRESH-ANGLE REPLY RULE");
  });

  it("surfaces a CLOSING SEGUE block when the packet carries a closingDirective", () => {
    const prompt = buildLiveSystemPrompt(anchorProfiles[0], {
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      selectedAnchors: ["neutral", "left", "right"],
      speakingOrder: ["neutral", "left", "right"],
      priorTranscriptExcerpts: [
        { anchorId: "left", text: "Left took the structural framing." },
        { anchorId: "right", text: "Right took the incentive angle." },
      ],
      responseGoal: "compare",
      debateConfig: { tone: "balanced", openingSpeaker: "auto", debateRounds: 2, includeModeratorBeat: true },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.85,
      closingDirective: "The desk has converged on this topic. Deliver a short transitional beat.",
    });

    expect(prompt).toContain("CLOSING SEGUE");
    expect(prompt).toContain("The desk has converged on this topic");
  });

  it("renders a fact-check evidence block when priorFactChecks is non-empty", () => {
    const prompt = buildLiveSystemPrompt(anchorProfiles[1], {
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      selectedAnchors: ["neutral", "left"],
      speakingOrder: ["neutral", "left"],
      priorTranscriptExcerpts: [
        { anchorId: "neutral", text: "Neutral set the consensus that turnout is the swing variable." },
      ],
      priorFactChecks: [
        {
          anchorId: "neutral",
          anchorLabel: "Avery Quinn",
          confidence: 85,
          claims: [
            {
              text: "Turnout was 67% in 2024",
              verdict: "verified",
              rationale: "Multiple outlets confirm.",
              sources: [{ outlet: "Reuters", url: "https://reuters.com/x" }],
            },
            {
              text: "Suburban swing was decisive",
              verdict: "disputed",
              rationale: "Analysts disagree.",
              sources: [{ outlet: "BBC News", url: "https://bbc.com/y" }],
            },
          ],
        },
      ],
      responseGoal: "compare",
      debateConfig: { tone: "balanced", openingSpeaker: "auto", debateRounds: 1, includeModeratorBeat: true },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.82,
    });

    expect(prompt).toContain("SUPPORTING EVIDENCE FROM REAL-TIME FACT-CHECK");
    expect(prompt).toContain("[VERIFIED]");
    expect(prompt).toContain("[DISPUTED]");
    expect(prompt).toContain("Reuters");
    expect(prompt).toContain("BBC News");
  });

  it("includes the yield schema and yield-vs-restate rule in the live system prompt", () => {
    const prompt = buildLiveSystemPrompt(anchorProfiles[1], {
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      selectedAnchors: ["neutral", "left"],
      speakingOrder: ["neutral", "left"],
      priorTranscriptExcerpts: [],
      sessionTranscript: [
        { role: "host", text: "What changed?" },
        { role: "anchor", anchorId: "neutral", anchorLabel: "Avery Quinn", text: "Neutral covered the latest." },
      ],
      responseGoal: "compare",
      debateConfig: { tone: "balanced", openingSpeaker: "auto", debateRounds: 1, includeModeratorBeat: true },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.82,
    });

    expect(prompt).toContain("yield?: { reason: string }");
    expect(prompt).toContain("YIELD INSTEAD OF RESTATING");
  });
});

describe("LiveResponseBuilder yield handling", () => {
  it("propagates a yield object from the provider through buildTurn", async () => {
    const builder = new LiveResponseBuilder(
      buildProvider({
        transcript: "I'll let Maya take this — she's already covered the core.",
        citedEvidenceIndexes: [],
        yield: { reason: "Maya already covered the same framing." },
      }),
    );

    const turn = await builder.buildTurn(anchorProfiles[0], {
      storyPacket: { ...storyPackets[0], sourceType: "live_feed" },
      selectedAnchors: ["neutral", "left"],
      speakingOrder: ["neutral", "left"],
      priorTranscriptExcerpts: [],
      responseGoal: "compare",
      debateConfig: { tone: "balanced", openingSpeaker: "auto", debateRounds: 1, includeModeratorBeat: true },
      safetyGuardrail: "Stay grounded.",
      confidence: 0.82,
    });

    expect(turn.yield?.reason).toBe("Maya already covered the same framing.");
    expect(turn.transcript).toContain("I'll let Maya take this");
  });
});
