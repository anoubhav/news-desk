import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { AnchorId, AnchorLean, AnchorProfile, DebateTonePreset, StoryPacket } from "../../shared/models";

// Local, private copy of labelFor. Agent B exports the canonical one from
// orchestrator.ts; we duplicate here to keep this module independently
// loadable and to avoid a circular import. Can be deduped post-merge.
function labelFor(anchorId: AnchorId): string {
  if (anchorId === "neutral") return "Neutral Desk";
  if (anchorId === "left") return "Left Lens";
  return "Right Lens";
}

const stopWords = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "did",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "more",
  "most",
  "new",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "over",
  "say",
  "said",
  "says",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "tell",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "would",
  "you",
  "article",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clipText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function sentenceSplit(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length > 40);
}

function paragraphSplit(value: string) {
  return value
    .split(/\n+/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter((paragraph) => paragraph.length > 60);
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index) => value.length > 0 && values.indexOf(value) === index);
}

function buildArticleContextName(anchorId: AnchorId, packet: StoryPacket) {
  return `article:v2:${anchorId}:${buildHash(`${packet.sourceUrl ?? packet.id}:${packet.title}`)}`;
}

function buildArticleLensGuidance(anchorId: AnchorId) {
  if (anchorId === "neutral") {
    return "Summarize clearly, separate confirmed facts from interpretation, and keep uncertainty explicit.";
  }

  if (anchorId === "left") {
    return "Stay grounded to the article while emphasizing impacts, institutions, accountability, and who carries the burden inside the article's facts.";
  }

  return "Stay grounded to the article while emphasizing agency, incentives, public order, credibility, and what the article foregrounds inside its facts.";
}

function buildArticleToneDirective(tone: DebateTonePreset) {
  if (tone === "calm") {
    return "Keep the exchange calm, restrained, and clarifying rather than combative.";
  }

  if (tone === "aggressive") {
    return "The exchange may be sharper and more adversarial, but it must remain factual, concise, and grounded to the article.";
  }

  return "Keep the exchange balanced, pointed, and broadcast-ready without becoming theatrical.";
}

function uniqueNormalizedStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (normalized.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function pushEvidence(
  target: { channel: string; lean: AnchorLean; timestamp: string; note: string }[],
  seen: Set<string>,
  note: string | undefined,
  channel: string,
  timestamp: string,
) {
  const normalized = normalizeWhitespace(note ?? "");
  const key = normalized.toLowerCase();
  if (normalized.length === 0 || seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push({
    channel,
    lean: "neutral",
    timestamp,
    note: normalized,
  });
}

function extractKeywords(...values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const token of value.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []) {
      if (stopWords.has(token)) {
        continue;
      }
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([token]) => token);
}

function inferAdSafetyState(text: string): StoryPacket["ad_safety_state"] {
  const normalized = text.toLowerCase();
  const unsafeTerms = ["shooting", "kill", "bomb", "riot", "blood", "violence", "assault"];
  const cautionTerms = ["protest", "border", "war", "crime", "arrest", "police"];

  if (unsafeTerms.some((term) => normalized.includes(term))) {
    return "unsafe";
  }

  if (cautionTerms.some((term) => normalized.includes(term))) {
    return "caution";
  }

  return "safe";
}

function fallbackParagraphs(document: Document) {
  return [...document.querySelectorAll("p")]
    .map((node) => normalizeWhitespace(node.textContent ?? ""))
    .filter((paragraph) => paragraph.length > 60)
    .slice(0, 10);
}

export function normalizePublicUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid public article URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only public http(s) article URLs are supported.");
  }

  return parsed;
}

export async function loadArticlePacket(url: string): Promise<StoryPacket> {
  const parsedUrl = normalizePublicUrl(url);
  const timeoutMs = 8000;
  const response = await fetch(parsedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
    const name = (error as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      console.warn(`[articleSource] fetch timed out after ${timeoutMs}ms for ${parsedUrl.toString()}`);
      throw new Error(`Article fetch timed out after ${timeoutMs}ms.`);
    }
    throw error;
  });

  if (!response.ok) {
    throw new Error(`Article fetch failed with ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("The URL did not return an HTML article page.");
  }

  const html = await response.text();
  const readerDom = new JSDOM(html, { url: response.url });
  const readerArticle = new Readability(readerDom.window.document).parse();
  const pageDom = new JSDOM(html, { url: response.url });
  const document = pageDom.window.document;

  const title =
    normalizeWhitespace(readerArticle?.title ?? "") ||
    normalizeWhitespace(document.querySelector("meta[property='og:title']")?.getAttribute("content") ?? "") ||
    normalizeWhitespace(document.title ?? "") ||
    parsedUrl.hostname;
  const excerpt =
    normalizeWhitespace(readerArticle?.excerpt ?? "") ||
    normalizeWhitespace(document.querySelector("meta[name='description']")?.getAttribute("content") ?? "");
  const byline =
    normalizeWhitespace(readerArticle?.byline ?? "") ||
    normalizeWhitespace(document.querySelector("meta[name='author']")?.getAttribute("content") ?? "") ||
    normalizeWhitespace(document.querySelector("meta[property='article:author']")?.getAttribute("content") ?? "");
  const siteName =
    normalizeWhitespace(document.querySelector("meta[property='og:site_name']")?.getAttribute("content") ?? "") ||
    parsedUrl.hostname;
  const textContent = normalizeWhitespace(readerArticle?.textContent ?? "");
  const paragraphs = paragraphSplit(textContent);
  const articleParagraphs = paragraphs.length > 0 ? paragraphs : fallbackParagraphs(document);
  const articleSentences = uniqueStrings(sentenceSplit(textContent));

  if (articleParagraphs.length === 0) {
    throw new Error("The article could not be extracted into readable text.");
  }

  const summaryLead = [excerpt, articleSentences[0], articleSentences[1], articleParagraphs[0]]
    .map((part) => normalizeWhitespace(part ?? ""))
    .filter((part, index, parts) => part.length > 0 && parts.indexOf(part) === index)
    .join(" ");
  const summary = clipText(summaryLead, 420);
  const body = clipText(articleParagraphs.join("\n\n"), 9000);
  const articleSnippets = uniqueNormalizedStrings([
    excerpt,
    ...articleSentences,
    ...articleParagraphs,
  ])
    .slice(0, 4)
    .map((snippet) => clipText(snippet, 220));
  const publishedAt =
    normalizeWhitespace(document.querySelector("meta[property='article:published_time']")?.getAttribute("content") ?? "") ||
    undefined;
  const sourceDomain = parsedUrl.hostname.replace(/^www\./, "");
  const now = new Date().toISOString();
  const evidenceChannel = siteName || sourceDomain;
  const sourceEvidence: StoryPacket["source_evidence"] = [];
  const seenEvidence = new Set<string>();

  pushEvidence(sourceEvidence, seenEvidence, byline ? `Byline: ${byline}` : undefined, evidenceChannel, now);
  pushEvidence(sourceEvidence, seenEvidence, publishedAt ? `Published: ${publishedAt}` : undefined, evidenceChannel, now);
  pushEvidence(sourceEvidence, seenEvidence, excerpt || undefined, evidenceChannel, now);

  for (const snippet of articleSnippets) {
    if (sourceEvidence.length >= 8) {
      break;
    }
    pushEvidence(sourceEvidence, seenEvidence, snippet, evidenceChannel, now);
  }

  for (const sentence of articleSentences) {
    if (sourceEvidence.length >= 8) {
      break;
    }
    pushEvidence(sourceEvidence, seenEvidence, sentence, evidenceChannel, now);
  }

  for (const paragraph of articleParagraphs) {
    if (sourceEvidence.length >= 8) {
      break;
    }
    pushEvidence(sourceEvidence, seenEvidence, paragraph, evidenceChannel, now);
  }

  const keywords = extractKeywords(title, excerpt, ...articleParagraphs.slice(0, 6));
  const safetyState = inferAdSafetyState(`${title} ${excerpt} ${body}`);
  const confidence = Math.min(
    0.97,
    0.55 + articleSnippets.length * 0.07 + (excerpt ? 0.08 : 0) + (readerArticle?.title ? 0.05 : 0),
  );
  const sourceTitle = title;

  return {
    id: `article-${slugify(sourceTitle) || buildHash(parsedUrl.toString())}`,
    story_id: `article-${buildHash(parsedUrl.toString())}`,
    sourceType: "article",
    title: sourceTitle,
    event_time_window: "Loaded now",
    topic: keywords[0] ?? sourceTitle.toLowerCase(),
    keywords_spiking: keywords,
    neutral_summary: summary,
    left_framing_summary:
      "Left Lens emphasizes impacts, institutions, and accountability using only the article's own facts.",
    right_framing_summary:
      "Right Lens emphasizes agency, incentives, public order, and credibility using only the article's own facts.",
    consensus_points: [
      `Neutral Desk is grounded to ${sourceDomain} reporting for this article.`,
      "Follow-up answers stay tied to the extracted article text and metadata.",
    ],
    divergence_points: [
      "Article-mode presenters can differ only in emphasis, not in the underlying facts.",
      "Ask about claims, evidence, names, timing, or direct details from the article.",
    ],
    sentiment_by_cluster: {
      neutral: "grounded",
      left: "interpretive",
      right: "interpretive",
    },
    ad_safety_state: safetyState,
    confidence,
    source_evidence: sourceEvidence,
    sourceUrl: response.url,
    sourceTitle,
    sourceDomain,
    sourceSiteName: siteName || sourceDomain,
    sourceByline: byline || undefined,
    sourcePublishedAt: publishedAt,
    articleBody: body,
    articleSnippets,
  };
}

export function buildArticleAnchorProfile(baseProfile: AnchorProfile, packet: StoryPacket): AnchorProfile {
  const articleTitle = packet.sourceTitle ?? packet.title;
  const articleSite = packet.sourceSiteName ?? packet.sourceDomain ?? "the loaded article";
  const articlePrompt = clipText(packet.articleBody ?? "", 6000);
  const articleSnippets = (packet.articleSnippets ?? [])
    .map((snippet, index) => `Snippet ${index + 1}: ${snippet}`)
    .join("\n");
  const articleLensGuidance = buildArticleLensGuidance(baseProfile.id);
  const toneGuidance = buildArticleToneDirective("balanced");
  const lensFraming =
    baseProfile.id === "left"
      ? packet.left_framing_summary
      : baseProfile.id === "right"
        ? packet.right_framing_summary
        : "";

  return {
    ...baseProfile,
    openingText: "",
    runtime: {
      ...baseProfile.runtime,
      contextId: undefined,
      contextMode: "dynamic",
      contextName: buildArticleContextName(baseProfile.id, packet),
    },
    instructions: [
      `You are ${baseProfile.label}.`,
      "You are discussing exactly one article. Never say 'loaded article'; do not announce or name the article in your reply.",
      "Stay grounded in the article's facts. If the user goes beyond them, say so directly and narrow back to the source — but do not say 'the article' more than once.",
      articleLensGuidance,
      toneGuidance,
      "Do not invent facts, motives, or claims beyond what the article text supports.",
      `Article title: ${articleTitle}`,
      `Article URL: ${packet.sourceUrl ?? "not provided"}`,
      `Article site: ${articleSite}`,
      packet.sourceByline ? `Byline: ${packet.sourceByline}` : "",
      packet.sourcePublishedAt ? `Published: ${packet.sourcePublishedAt}` : "",
      `Article summary: ${packet.neutral_summary}`,
      lensFraming ? `Your lens framing of the same facts: ${lensFraming}` : "",
      `Source evidence:\n${
        packet.source_evidence.length > 0
          ? packet.source_evidence.map((evidence, index) => `${index + 1}. ${evidence.note}`).join("\n")
          : "No evidence available."
      }`,
      `Readable snippets:\n${articleSnippets || "No snippets available."}`,
      `Article text excerpt:\n${articlePrompt}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildArticleAnchorProfiles(
  baseProfiles: Record<AnchorId, AnchorProfile>,
  packet: StoryPacket,
) {
  return Object.fromEntries(
    Object.entries(baseProfiles).map(([anchorId, profile]) => [
      anchorId,
      buildArticleAnchorProfile(profile, packet),
    ]),
  ) as Record<AnchorId, AnchorProfile>;
}

export function buildArticleNeutralProfile(baseProfile: AnchorProfile, packet: StoryPacket): AnchorProfile {
  return buildArticleAnchorProfile(baseProfile, packet);
}

export interface BuildArticleFallbackOptions {
  priorExcerpt?: string;
  priorAnchorId?: AnchorId;
  tone?: DebateTonePreset;
}

export function buildArticleFallbackResponse(
  packet: StoryPacket,
  prompt: string,
  anchor?: AnchorProfile,
  options?: BuildArticleFallbackOptions,
) {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const snippets = packet.articleSnippets ?? [];
  const anchorId = anchor?.id ?? "neutral";
  const priorAnchorId = options?.priorAnchorId;
  const replyPrefix = options?.priorExcerpt
    ? priorAnchorId
      ? `${labelFor(anchorId)} to ${labelFor(priorAnchorId)}: `
      : `${labelFor(anchorId)} to the prior anchor: `
    : "";
  const toneLead =
    options?.tone === "aggressive"
      ? "Make the disagreement crisp but still article-grounded."
      : options?.tone === "calm"
        ? "Keep the disagreement measured and article-grounded."
        : "Keep the disagreement balanced and article-grounded.";
  const lensLead =
    anchorId === "neutral"
      ? ""
      : anchorId === "left"
        ? `${replyPrefix}From a left-leaning read, `
        : `${replyPrefix}From a right-leaning read, `;
  const evidencePool = uniqueStrings([
    ...sentenceSplit(packet.articleBody ?? ""),
    ...snippets,
    ...packet.source_evidence.map((evidence) => evidence.note),
  ]);

  if (
    normalizedPrompt.length === 0 ||
    normalizedPrompt.includes("summary") ||
    normalizedPrompt.includes("catch me up") ||
    normalizedPrompt.includes("what changed") ||
    normalizedPrompt.includes("what is this about")
  ) {
    return {
      transcript:
        anchorId === "neutral"
          ? `In brief: ${packet.neutral_summary}`
          : `${lensLead}${toneLead} the throughline is ${packet.neutral_summary}`,
      sourceExcerpt: snippets[0] ?? packet.source_evidence[0]?.note,
    };
  }

  if (normalizedPrompt.includes("who wrote") || normalizedPrompt.includes("author") || normalizedPrompt.includes("byline")) {
    if (packet.sourceByline) {
      return {
        transcript: `The byline is ${packet.sourceByline}.`,
        sourceExcerpt: packet.sourceByline,
      };
    }

    return {
      transcript: "There is no byline in the extracted metadata, so I cannot confirm the author.",
      sourceExcerpt: snippets[0] ?? packet.source_evidence[0]?.note,
    };
  }

  if (normalizedPrompt.includes("where is this from") || normalizedPrompt.includes("what source")) {
    return {
      transcript: `Source: ${packet.sourceSiteName ?? packet.sourceDomain ?? "the source site"}${packet.sourceUrl ? ` (${packet.sourceUrl})` : ""}.`,
      sourceExcerpt: packet.sourceUrl ?? packet.sourceDomain,
    };
  }

  if (normalizedPrompt.includes("when") && normalizedPrompt.includes("publish")) {
    if (packet.sourcePublishedAt) {
      return {
        transcript: `The extracted metadata lists the publication time as ${packet.sourcePublishedAt}.`,
        sourceExcerpt: packet.sourcePublishedAt,
      };
    }

    return {
      transcript:
        "There is no publication timestamp in the extracted metadata, so I cannot confirm when it was published.",
      sourceExcerpt: snippets[0] ?? packet.source_evidence[0]?.note,
    };
  }

  if (normalizedPrompt.includes("when")) {
    const datedSentence = evidencePool
      .filter(
        (snippet) =>
          /\b(january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b/i.test(
            snippet,
          ) && /\b(election|scheduled|held|vote|poll)\b/i.test(snippet),
      )
      .sort((left, right) => left.length - right.length)[0];

    if (datedSentence) {
      return {
        transcript: datedSentence,
        sourceExcerpt: datedSentence,
      };
    }
  }

  if (normalizedPrompt.includes("main claim") || normalizedPrompt.includes("what is this about")) {
    return {
      transcript:
        anchorId === "neutral"
          ? `The main throughline: ${packet.neutral_summary}`
          : `${lensLead}the main throughline is ${packet.neutral_summary}`,
      sourceExcerpt: snippets[0] ?? packet.source_evidence[0]?.note,
    };
  }

  const promptTokens = extractKeywords(normalizedPrompt);
  const rankedSnippets = evidencePool
    .map((snippet) => {
      const lowerSnippet = snippet.toLowerCase();
      let score = promptTokens.reduce((total, token) => total + (lowerSnippet.includes(token) ? 1 : 0), 0);

      if (normalizedPrompt.includes("when") && /\b(january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b/i.test(snippet)) {
        score += 2;
      }

      if ((normalizedPrompt.includes("who") || normalizedPrompt.includes("name")) && /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(snippet)) {
        score += 1;
      }

      return {
        snippet,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedSnippets.length > 0) {
    const [primary, secondary] = rankedSnippets;
    const secondaryClause = secondary ? ` It also notes: ${secondary.snippet}` : "";
    return {
      transcript:
        anchorId === "neutral"
          ? `${primary.snippet}${secondaryClause}`
          : `${lensLead}the strongest backed point is ${primary.snippet}${secondaryClause}`,
      sourceExcerpt: primary.snippet,
    };
  }

  return {
    transcript:
      anchorId === "neutral"
        ? "I do not see enough support in the extracted text to answer that directly. Ask about the headline, named people, claims, timeline, or evidence."
        : `${lensLead}I cannot support a stronger ${anchorId} framing from the extracted text alone. Ask about the headline, named people, claims, timeline, or evidence.`,
    sourceExcerpt: snippets[0] ?? packet.source_evidence[0]?.note,
  };
}
