import { describe, expect, it } from "vitest";
import {
  buildFactCheckSystemPrompt,
  buildFactCheckUserPrompt,
  dedupeSources,
  extractJsonBlock,
  outletFromUrl,
  parseFactCheckText,
} from "./builder";
import type { FactCheckRequest } from "../../../shared/models";

describe("outletFromUrl", () => {
  it("returns known outlet names for common hosts", () => {
    expect(outletFromUrl("https://www.reuters.com/world/article")).toBe("Reuters");
    expect(outletFromUrl("https://bbc.co.uk/news/123")).toBe("BBC News");
    expect(outletFromUrl("https://www.nytimes.com/2026/05/15/foo")).toBe("The New York Times");
  });

  it("falls back to capitalized domain root for unknown hosts", () => {
    expect(outletFromUrl("https://www.example.com/page")).toBe("Example");
  });

  it("returns Source on invalid URLs", () => {
    expect(outletFromUrl("not a url")).toBe("Source");
  });
});

describe("extractJsonBlock", () => {
  it("extracts JSON wrapped in ```json fences", () => {
    const text = "Some preamble\n```json\n{\"claims\": []}\n```\ntrailing";
    expect(extractJsonBlock(text)).toBe('{"claims": []}');
  });

  it("returns raw text when it starts with a brace", () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}');
  });

  it("returns null for empty input", () => {
    expect(extractJsonBlock("")).toBeNull();
  });
});

describe("parseFactCheckText", () => {
  it("parses a well-formed fenced response", () => {
    const text = '```json\n{"confidence": 82, "claims": [{"text": "The bill passed.", "verdict": "verified", "rationale": "Confirmed.", "sourceIndexes": [0]}]}\n```';
    const result = parseFactCheckText(text);
    expect(result.confidence).toBe(82);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toBe("The bill passed.");
    expect(result.claims[0].verdict).toBe("verified");
    expect(result.claims[0].sourceIndexes).toEqual([0]);
  });

  it("trims to at most 3 claims", () => {
    const text = JSON.stringify({
      claims: [
        { text: "a", verdict: "verified" },
        { text: "b", verdict: "verified" },
        { text: "c", verdict: "verified" },
        { text: "d", verdict: "verified" },
      ],
    });
    expect(parseFactCheckText(text).claims).toHaveLength(3);
  });

  it("drops claims with empty text", () => {
    const text = JSON.stringify({ claims: [{ text: "  ", verdict: "verified" }, { text: "real", verdict: "verified" }] });
    const result = parseFactCheckText(text);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toBe("real");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseFactCheckText("not json")).toThrow();
  });
});

describe("buildFactCheckSystemPrompt", () => {
  it("mentions articleContext grounding rule", () => {
    const prompt = buildFactCheckSystemPrompt();
    expect(prompt).toContain("articleContext");
  });
});

describe("buildFactCheckUserPrompt", () => {
  const baseRequest: FactCheckRequest = {
    turnId: "turn-1",
    transcript: "The bill passed the senate on Tuesday.",
    storyTitle: "Senate race tightens after debate",
    storyTopic: "senate",
    anchorLean: "left",
  };

  it("omits articleContext when not provided", () => {
    const json = buildFactCheckUserPrompt(baseRequest);
    expect(json).not.toContain("articleContext");
  });

  it("serializes articleContext fields when provided", () => {
    const json = buildFactCheckUserPrompt({
      ...baseRequest,
      articleContext: {
        sourceUrl: "https://example.com/politics/senate-race-tightens",
        sourceTitle: "Senate race tightens after debate",
        sourceDomain: "example.com",
        neutralSummary: "A new poll narrows the battleground senate map.",
        lensFraming: "Workers, institutional accountability, and turnout access are the throughline.",
        articleExcerpt: "Campaign aides pointed to suburban counties and ad reservations as pressure points.",
      },
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.articleContext).toMatchObject({
      sourceUrl: "https://example.com/politics/senate-race-tightens",
      sourceDomain: "example.com",
      neutralSummary: expect.stringContaining("battleground senate map"),
      lensFraming: expect.stringContaining("institutional accountability"),
      articleExcerpt: expect.stringContaining("suburban counties"),
    });
  });
});

describe("dedupeSources", () => {
  it("removes duplicate URLs while preserving order", () => {
    const out = dedupeSources([
      { outlet: "Reuters", url: "https://reuters.com/a" },
      { outlet: "Reuters", url: "https://reuters.com/a" },
      { outlet: "BBC News", url: "https://bbc.com/b" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://reuters.com/a");
    expect(out[1].url).toBe("https://bbc.com/b");
  });
});
