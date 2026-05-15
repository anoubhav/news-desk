import { afterEach, describe, expect, it, vi } from "vitest";
import { anchorProfiles } from "../data/anchors";
import {
  buildArticleAnchorProfile,
  buildArticleFallbackResponse,
  buildArticleNeutralProfile,
  loadArticlePacket,
} from "./articleSource";

const articleHtml = `
  <!doctype html>
  <html lang="en">
      <head>
      <title>Senate race tightens after debate</title>
      <meta property="og:title" content="Senate race tightens after debate" />
      <meta property="og:site_name" content="Metro Chronicle" />
      <meta name="description" content="A new poll and debate fallout are reshaping the battleground senate map." />
      <meta name="author" content="Jordan Hale" />
      <meta property="article:published_time" content="2026-04-09T10:30:00Z" />
    </head>
    <body>
      <article>
        <p>Democratic and Republican strategists both shifted resources after a debate in the state's senate race.</p>
        <p>The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.</p>
        <p>Campaign aides pointed to suburban counties, fundraising, and ad reservation changes as the next pressure points.</p>
        <p>Analysts told the Chronicle that message discipline mattered more than any single viral moment from the debate stage.</p>
      </article>
    </body>
  </html>
`;

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("articleSource", () => {
  it("loads a public article into an article-backed story packet", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/politics/senate-race-tightens",
      headers: new Headers({
        "content-type": "text/html; charset=utf-8",
      }),
      text: async () => articleHtml,
    } as Response);

    const packet = await loadArticlePacket("https://example.com/politics/senate-race-tightens");

    expect(packet.sourceType).toBe("article");
    expect(packet.sourceUrl).toBe("https://example.com/politics/senate-race-tightens");
    expect(packet.sourceSiteName).toBe("Metro Chronicle");
    expect(packet.sourceByline).toBe("Jordan Hale");
    expect(packet.sourcePublishedAt).toBe("2026-04-09T10:30:00Z");
    expect(packet.articleSnippets?.length).toBeGreaterThan(0);
    expect(packet.articleSnippets?.every((snippet) => !snippet.startsWith("Snippet "))).toBe(true);
    expect(packet.source_evidence.some((evidence) => evidence.note.startsWith("Byline: Jordan Hale"))).toBe(true);
    expect(packet.source_evidence.some((evidence) => evidence.note.startsWith("Published: 2026-04-09T10:30:00Z"))).toBe(
      true,
    );
    expect(packet.neutral_summary).toContain("battleground senate map");
  });

  it("rejects non-html responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/feed.json",
      headers: new Headers({
        "content-type": "application/json",
      }),
      text: async () => "{\"ok\":true}",
    } as Response);

    await expect(loadArticlePacket("https://example.com/feed.json")).rejects.toThrow(
      "The URL did not return an HTML article page.",
    );
  });

  it("builds a neutral article profile and grounded follow-up answers", () => {
    const packet = {
      id: "article-demo",
      title: "Senate race tightens after debate",
      story_id: "article-demo",
      sourceType: "article" as const,
      event_time_window: "Loaded now",
      topic: "senate",
      keywords_spiking: ["senate", "debate", "turnout"],
      neutral_summary: "A new poll and debate fallout are reshaping the battleground senate map.",
      left_framing_summary:
        "Left Lens should stay grounded to the loaded article and emphasize impacts, institutions, and accountability using only the article's own facts.",
      right_framing_summary:
        "Right Lens should stay grounded to the loaded article and emphasize agency, incentives, public order, and credibility using only the article's own facts.",
      consensus_points: ["Grounded to one article."],
      divergence_points: ["Presenters can differ only in emphasis, not in the underlying facts."],
      sentiment_by_cluster: {
        neutral: "grounded",
        left: "interpretive",
        right: "interpretive",
      },
      ad_safety_state: "safe" as const,
      confidence: 0.91,
      source_evidence: [
        {
          channel: "Metro Chronicle",
          lean: "neutral" as const,
          timestamp: "2026-04-09T10:30:00Z",
          note: "The late poll showed the contest narrowing.",
        },
      ],
      sourceUrl: "https://example.com/politics/senate-race-tightens",
      sourceTitle: "Senate race tightens after debate",
      sourceDomain: "example.com",
      sourceSiteName: "Metro Chronicle",
      sourceByline: "Jordan Hale",
      sourcePublishedAt: "2026-04-09T10:30:00Z",
      articleBody:
        "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns. The election will be held on November 3, 2026.",
      articleSnippets: [
        "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
        "The election will be held on November 3, 2026.",
        "Campaign aides pointed to suburban counties, fundraising, and ad reservation changes as the next pressure points.",
      ],
    };

    const profile = buildArticleNeutralProfile(anchorProfiles[0], packet);
    const authorResponse = buildArticleFallbackResponse(packet, "Who wrote this article?");
    const timingResponse = buildArticleFallbackResponse(packet, "When is the election?");
    const outOfScopeResponse = buildArticleFallbackResponse(packet, "What did it say about semiconductor export controls?");

    expect(profile.runtime.contextMode).toBe("dynamic");
    expect(profile.runtime.contextName.startsWith("article:")).toBe(true);
    expect(profile.instructions).toContain("Jordan Hale");
    expect(authorResponse.transcript).toContain("Jordan Hale");
    expect(timingResponse.transcript).toContain("November 3, 2026");
    expect(outOfScopeResponse.transcript).toContain("I do not see enough support in the extracted text");
  });

  it("uses directional named attribution when priorAnchorId is provided", () => {
    const packet = {
      id: "article-demo",
      title: "Senate race tightens after debate",
      story_id: "article-demo",
      sourceType: "article" as const,
      event_time_window: "Loaded now",
      topic: "senate",
      keywords_spiking: ["senate", "debate", "turnout"],
      neutral_summary: "A new poll and debate fallout are reshaping the battleground senate map.",
      left_framing_summary:
        "Left Lens should stay grounded to the loaded article and emphasize impacts, institutions, and accountability using only the article's own facts.",
      right_framing_summary:
        "Right Lens should stay grounded to the loaded article and emphasize agency, incentives, public order, and credibility using only the article's own facts.",
      consensus_points: ["Grounded to one article."],
      divergence_points: ["Presenters can differ only in emphasis, not in the underlying facts."],
      sentiment_by_cluster: {
        neutral: "grounded",
        left: "interpretive",
        right: "interpretive",
      },
      ad_safety_state: "safe" as const,
      confidence: 0.91,
      source_evidence: [
        {
          channel: "Metro Chronicle",
          lean: "neutral" as const,
          timestamp: "2026-04-09T10:30:00Z",
          note: "The late poll showed the contest narrowing.",
        },
      ],
      sourceUrl: "https://example.com/politics/senate-race-tightens",
      sourceTitle: "Senate race tightens after debate",
      sourceDomain: "example.com",
      sourceSiteName: "Metro Chronicle",
      sourceByline: "Jordan Hale",
      sourcePublishedAt: "2026-04-09T10:30:00Z",
      articleBody:
        "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns. The election will be held on November 3, 2026.",
      articleSnippets: [
        "The article says a late poll showed the contest narrowing, with turnout strategy now central for both campaigns.",
        "The election will be held on November 3, 2026.",
        "Campaign aides pointed to suburban counties, fundraising, and ad reservation changes as the next pressure points.",
      ],
    };

    const leftProfile = anchorProfiles.find((profile) => profile.id === "left");
    expect(leftProfile).toBeDefined();

    const named = buildArticleFallbackResponse(packet, "What's the framing?", leftProfile, {
      priorExcerpt: "Neutral set the consensus that turnout is the swing variable.",
      priorAnchorId: "neutral",
      tone: "balanced",
    });
    expect(named.transcript).toContain("Left Lens to Neutral Desk:");

    const unnamed = buildArticleFallbackResponse(packet, "What's the framing?", leftProfile, {
      priorExcerpt: "Neutral set the consensus that turnout is the swing variable.",
      tone: "balanced",
    });
    expect(unnamed.transcript).toContain("Left Lens to the prior anchor:");
  });

  it("injects the lens-matched framing into article anchor profiles", () => {
    const packet = {
      id: "article-demo",
      title: "Senate race tightens after debate",
      story_id: "article-demo",
      sourceType: "article" as const,
      event_time_window: "Loaded now",
      topic: "senate",
      keywords_spiking: ["senate", "debate", "turnout"],
      neutral_summary: "A new poll and debate fallout are reshaping the battleground senate map.",
      left_framing_summary:
        "Workers in suburban counties carry the turnout burden; institutional access and ad reservations decide reach.",
      right_framing_summary:
        "Voter agency and message discipline drive the contest; campaign incentives and credibility shape the late shift.",
      consensus_points: ["Grounded to one article."],
      divergence_points: ["Presenters can differ only in emphasis, not in the underlying facts."],
      sentiment_by_cluster: {
        neutral: "grounded",
        left: "interpretive",
        right: "interpretive",
      },
      ad_safety_state: "safe" as const,
      confidence: 0.91,
      source_evidence: [
        {
          channel: "Metro Chronicle",
          lean: "neutral" as const,
          timestamp: "2026-04-09T10:30:00Z",
          note: "The late poll showed the contest narrowing.",
        },
      ],
      sourceUrl: "https://example.com/politics/senate-race-tightens",
      sourceTitle: "Senate race tightens after debate",
      sourceDomain: "example.com",
      sourceSiteName: "Metro Chronicle",
      sourceByline: "Jordan Hale",
      sourcePublishedAt: "2026-04-09T10:30:00Z",
      articleBody: "The article says a late poll showed the contest narrowing.",
      articleSnippets: [
        "The article says a late poll showed the contest narrowing.",
      ],
    };

    const leftBase = anchorProfiles.find((profile) => profile.id === "left");
    const rightBase = anchorProfiles.find((profile) => profile.id === "right");
    const neutralBase = anchorProfiles.find((profile) => profile.id === "neutral");
    expect(leftBase && rightBase && neutralBase).toBeTruthy();

    const leftProfile = buildArticleAnchorProfile(leftBase!, packet);
    const rightProfile = buildArticleAnchorProfile(rightBase!, packet);
    const neutralProfile = buildArticleAnchorProfile(neutralBase!, packet);

    expect(leftProfile.instructions).toContain("Workers in suburban counties carry the turnout burden");
    expect(leftProfile.instructions).not.toContain("Voter agency and message discipline");
    expect(rightProfile.instructions).toContain("Voter agency and message discipline drive the contest");
    expect(rightProfile.instructions).not.toContain("Workers in suburban counties carry the turnout burden");
    expect(neutralProfile.instructions).not.toContain("Workers in suburban counties carry the turnout burden");
    expect(neutralProfile.instructions).not.toContain("Voter agency and message discipline");
  });
});
