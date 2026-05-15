import type {
  AnchorId,
  AnchorProfile,
  DebateConfig,
  GenerationSource,
  PanelPacket,
  PriorFactCheck,
  PriorTranscriptExcerpt,
  ResponseGoal,
  SessionTranscriptEntry,
  SourceEvidence,
  StoryPacket,
} from "../../../shared/models";
import type { LiveResponseOverride, LiveResponseProvider, LiveResponseYield } from "./provider";

function clipText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}...`;
}

function uniqueIndexes(indexes: number[], length: number) {
  return Array.from(new Set(indexes)).filter((index) => Number.isInteger(index) && index >= 0 && index < length);
}

const leadInPatterns: RegExp[] = [
  /^\s*(?:the\s+)?left[- ]leaning\s+read\s+is[,:\s]*/i,
  /^\s*(?:the\s+)?right[- ]leaning\s+read\s+is[,:\s]*/i,
  /^\s*what\s+we\s+can\s+say\s+with\s+confidence\s+is[,:\s]*/i,
  /^\s*(?:neutral\s+desk|left\s+lens|right\s+lens|moderator)\s*(?:take|read|view|perspective|here)?\s*[,:\-—–]\s*/i,
  /^\s*(?:from|through|speaking\s+from|on)\s+(?:a\s+|the\s+)?(?:left|right|neutral|center)(?:[- ]leaning)?\s+(?:lens|perspective|read|view|side|angle|vantage)\s*[,:\-—–]?\s*/i,
  /^\s*(?:from|on)\s+(?:the\s+)?(?:left|right|neutral|center)\s*[,:\-—–]\s*/i,
  /^\s*(?:as|speaking\s+as)\s+(?:the\s+)?(?:left|right|neutral|center)(?:[- ]leaning)?\s+(?:anchor|analyst|lens|moderator)\s*[,:\-—–]?\s*/i,
  /^\s*(?:i\s+am|i'm)\s+(?:avery(?:\s+quinn)?|maya(?:\s+reyes)?|cole(?:\s+brennan)?)[,.\s]*/i,
  /^\s*(?:avery(?:\s+quinn)?|maya(?:\s+reyes)?|cole(?:\s+brennan)?)\s+here[,.\s]*/i,
  /^\s*(?:this\s+(?:is|article)|the\s+article)[^.]{0,60}(?:says|reports|states|covers|is\s+about)[^.]{0,80}\.\s*/i,
  /^\s*(?:i\s+(?:have|am|'ve|'m))\s+(?:loaded|loading)[^.]{0,80}\.\s*/i,
  /^\s*based\s+on\s+(?:the\s+)?(?:loaded\s+)?article[,:\s]*/i,
  /^\s*from\s+(?:a\s+)?(?:left|right)[- ]leaning\s+read\s+of\s+(?:the\s+)?(?:loaded\s+)?article[,:\s]*/i,
  /^\s*here\s+is\s+(?:the\s+)?(?:loaded\s+)?article\s+in\s+brief[,:\s]*/i,
  /^\s*(?:the\s+)?(?:loaded\s+)?article\s+(?:lists|says|reports|states|covers)[^.]{0,80}\.\s*/i,
  /^\s*staying\s+grounded\s+to\s+(?:the\s+)?(?:loaded\s+)?article[,.\s]*/i,
];

function stripBoilerplatePreamble(value: string): string {
  let result = value;
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const pattern of leadInPatterns) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  result = result.trim();
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  return result;
}

let canonicalLabelResolver: ((anchorId: AnchorId) => string | undefined) | null = null;

export function registerCanonicalAnchorLabelResolver(resolver: (anchorId: AnchorId) => string | undefined) {
  canonicalLabelResolver = resolver;
}

function labelFor(anchor: AnchorProfile | AnchorId, profiles?: Partial<Record<AnchorId, Pick<AnchorProfile, "label">>>): string {
  if (typeof anchor !== "string") {
    return anchor.label;
  }
  const profile = profiles?.[anchor];
  if (profile?.label) {
    return profile.label;
  }
  const canonical = canonicalLabelResolver?.(anchor);
  if (canonical) {
    return canonical;
  }
  if (anchor === "neutral") return "the moderator";
  if (anchor === "left") return "the left-side analyst";
  return "the right-side analyst";
}

const expressivenessDirective = [
  "Sound like a live news anchor — confident, varied cadence, light energy shift. Get straight to the substance.",
  "VOICE:",
  "- Open with the sharpest specific in the material — a name, a number, a date, a verb. Not 'The article says...', not 'On this story...', not a windup.",
  "- One vivid verb per turn, zero filler, zero hedging stacks. 'Reports point to' is filler; 'Reuters clocked the figure at X' is voice.",
  "- If you can swap a generic noun ('the deal', 'the figure') for the specific one ('the 2015 JCPOA', '97%') without bloating the sentence, do it.",
  "HARD RULES:",
  "- DO NOT introduce yourself by name or title (no 'I'm Avery', 'I'm Maya', 'I am the left-side analyst', etc.).",
  "- DO NOT open with a lens or perspective label. NEVER start with 'From the left lens', 'From the right lens', 'Through the left lens', 'Speaking from the right', 'From a left-leaning read', 'Left Lens take:', 'Right Lens —', 'As the neutral anchor', or any variant. Just state the substance directly.",
  "- DO NOT say 'loaded article', 'this article', 'the article says', 'based on the article', or 'staying grounded to the article'. Just state the substance.",
  "- DO NOT echo your role (left-side analyst, moderator, right-side analyst, lens, etc.) in the reply.",
  "- DO NOT announce the article title, byline, or publication.",
  "- If you must reference the prior speaker, use only their first name once, then move to substance.",
].join("\n");

function buildAnchorDirective(anchor: AnchorProfile) {
  if (anchor.id === "neutral") {
    return [
      `${anchor.label} explains what changed, names where reporting clusters agree, and names where they split.`,
      "End with the next concrete signal to watch. State uncertainty explicitly; do not assign motive as fact.",
      "When PRIOR TURNS exist, your reply MUST surface what's still unresolved between clusters or what concrete signal would change the read. If both have already been covered, yield.",
    ].join(" ");
  }
  if (anchor.id === "left") {
    return [
      `${anchor.label} describes how left-leaning newsrooms are framing this — an analyst, not an advocate.`,
      "Cite at least one structural factor (policy, institution, access).",
      "When prior turns include the right-side analyst, name them and restate their strongest point before pushing back. Do not caricature.",
      "When PRIOR TURNS exist, your reply MUST surface a structural factor (policy, institution, access, who carries the cost) that prior speakers did NOT name. If you cannot name a fresh one grounded in the material, yield.",
    ].join(" ");
  }
  return [
    `${anchor.label} describes how right-leaning newsrooms are framing this — an analyst, not a partisan.`,
    "Cite at least one incentive or accountability angle.",
    "When prior turns include the left-side analyst, name them and acknowledge their strongest point before contesting it. Do not caricature.",
    "When PRIOR TURNS exist, your reply MUST surface an incentive or accountability angle (who gains, what behavior gets rewarded, where credibility is on the line) that prior speakers did NOT name. If you cannot name a fresh one grounded in the material, yield.",
  ].join(" ");
}

function buildSessionTranscriptBlock(
  anchor: Pick<AnchorProfile, "id" | "label">,
  sessionTranscript: SessionTranscriptEntry[] | undefined,
): string[] {
  if (!sessionTranscript || sessionTranscript.length === 0) {
    return [];
  }

  const lines: string[] = ["", "SESSION SO FAR (full transcript, oldest → newest):"];
  sessionTranscript.forEach((entry, index) => {
    if (entry.role === "host") {
      lines.push(`[${index + 1}] HOST: "${clipText(entry.text, 600)}"`);
      return;
    }
    const speakerLabel = entry.anchorLabel ?? (entry.anchorId ? labelFor(entry.anchorId) : "anchor");
    const speakerId = entry.anchorId ? entry.anchorId.toUpperCase() : "ANCHOR";
    lines.push(`[${index + 1}] ${speakerId} (${speakerLabel}): "${clipText(entry.text, 600)}"`);
  });

  const selfTurns = sessionTranscript.filter((entry) => entry.role === "anchor" && entry.anchorId === anchor.id).length;
  lines.push("");
  lines.push("HARD RULES FOR THIS TURN:");
  if (selfTurns > 0) {
    lines.push(
      `- You (${anchor.label}) have already spoken ${selfTurns} time${selfTurns === 1 ? "" : "s"} in this session. Do NOT restate your own earlier points, examples, framings, or one-liners.`,
    );
  }
  lines.push(
    "- Do not repeat points, examples, framings, or one-liners anyone has already used this session.",
    "- PARAPHRASE TEST: before speaking, mentally compress each PRIOR TURN to its core claim. If your turn compresses to the same core claim — even with new wording, a new outlet name, or a different caveat — that is a paraphrase. Yield.",
    "- A different sentence structure is not a different point. A different adjective is not a different point. A different verb is not a different point.",
    "- Surface a NEW facet: who benefits, who pays, what's an incentive, what's a structural cause, what's missing from the record, what's the next signal to watch, what would change the read. Pick one, concretely.",
    "- If a peer said something specific earlier, name it and either build on it with new substance or push back with specifics — never restart the topic from scratch.",
    "- If the topic was already covered, acknowledge it briefly and advance the line of argument.",
    "- You may reference earlier turns by anchor label (e.g. \"as Avery noted earlier...\") when it sharpens the exchange.",
    "- YIELD INSTEAD OF RESTATING: If your only available framing, example, or one-liner is already in PRIOR TURNS, return a yield. Set `yield: { reason: \"<short why>\" }` AND make `transcript` a single short handoff sentence (≤14 words) that names the peer whose point you'd build on — e.g. \"I'll let Maya take this — she's already covered the core.\" Do NOT introduce a fresh argument when yielding.",
    "- The desk values silence over redundancy. Yielding cleanly is preferred to weak restatement.",
  );

  return lines;
}

function buildFactCheckEvidenceBlock(
  priorFactChecks: PriorFactCheck[] | undefined,
  profileMap: Partial<Record<AnchorId, Pick<AnchorProfile, "label">>>,
): string[] {
  if (!priorFactChecks || priorFactChecks.length === 0) {
    return [];
  }

  const lines: string[] = [
    "",
    "SUPPORTING EVIDENCE FROM REAL-TIME FACT-CHECK (cite by outlet name, not by index):",
  ];

  let claimCount = 0;
  for (const entry of priorFactChecks) {
    const speakerLabel = labelFor(entry.anchorId, profileMap);
    for (const claim of entry.claims) {
      if (claimCount >= 6) break;
      const tag = claim.verdict.toUpperCase();
      const outlets = claim.sources.length > 0
        ? claim.sources.map((source) => source.outlet).filter(Boolean).slice(0, 3).join(", ")
        : "no outlet";
      const rationale = claim.rationale ? ` Rationale: ${clipText(claim.rationale, 140)}.` : "";
      lines.push(
        `- [${tag}] "${clipText(claim.text, 140)}" said by ${speakerLabel}. Sources: ${outlets}.${rationale}`,
      );
      claimCount += 1;
    }
    if (claimCount >= 6) break;
  }

  if (claimCount === 0) {
    return [];
  }

  lines.push(
    "",
    "EVIDENCE RULES:",
    "- You MAY cite verified claims by outlet name to ground your point (e.g. \"Reuters reported...\").",
    "- You SHOULD push back on disputed peer claims when relevant — name the peer and reference the contradicting source.",
    "- Treat opinion-tagged items as framing, not fact.",
    "- Do NOT cite an outlet that does not appear in this list. Do not invent outlets.",
  );

  return lines;
}

function buildDebateToneGuidance(tone: DebateConfig["tone"]) {
  if (tone === "calm") {
    return "Keep the exchange calm, restrained, and clarifying rather than combative.";
  }

  if (tone === "aggressive") {
    return "The exchange may be sharper and more adversarial, but it must remain concise, factual, and grounded.";
  }

  return "Keep the exchange balanced, pointed, and broadcast-ready without becoming theatrical.";
}

function buildLiveSystemPrompt(anchor: AnchorProfile, packet: PanelPacket) {
  const profileMap: Partial<Record<AnchorId, Pick<AnchorProfile, "label">>> = {
    [anchor.id]: { label: anchor.label },
  };
  for (const excerpt of packet.priorTranscriptExcerpts) {
    if (!profileMap[excerpt.anchorId]) {
      profileMap[excerpt.anchorId] = { label: labelFor(excerpt.anchorId) };
    }
  }

  const lines: string[] = [
    `You are ${anchor.label}, one of three anchors at a live news desk.`,
    "Return only JSON that matches the required schema.",
    "Schema: { transcript: string, citedEvidenceIndexes: number[], yield?: { reason: string } }",
    "Never invent facts, motives, source evidence, or citation indexes.",
    "Use only evidence indexes from the provided evidence list.",
    "Keep the transcript tight for speech: 1 to 2 sentences, under 45 words. No throat-clearing, no recaps, no meta. Lead with the point.",
    expressivenessDirective,
    buildAnchorDirective(anchor),
    buildDebateToneGuidance(packet.debateConfig?.tone ?? "balanced"),
    `Response goal: ${packet.responseGoal}.`,
  ];
  if (packet.confidence < 0.8) {
    lines.push("Because confidence is below 0.8, explicitly signal uncertainty or that the read is still developing.");
  }
  if (packet.storyPacket.ad_safety_state !== "safe") {
    lines.push("Because safety is not fully safe, avoid inflammatory phrasing and keep the language restrained.");
  }
  lines.push(...buildSessionTranscriptBlock(anchor, packet.sessionTranscript));
  if (packet.priorTranscriptExcerpts.length > 0) {
    lines.push("");
    lines.push("PRIOR TURNS IN THIS PANEL (most recent last):");
    for (const excerpt of packet.priorTranscriptExcerpts) {
      lines.push(`- ${labelFor(excerpt.anchorId, profileMap)}: "${clipText(excerpt.text, 220)}"`);
    }
    const last = packet.priorTranscriptExcerpts[packet.priorTranscriptExcerpts.length - 1];
    lines.push(
      [
        "FRESH-ANGLE REPLY RULE:",
        `- If your point is a paraphrase of any PRIOR TURN above — same claim, same caveat, same framing in different words — you MUST yield. Do not restate.`,
        `- Otherwise: name "${labelFor(last.anchorId, profileMap)}" by first name once, then deliver one specific facet the prior turns have not covered (a different actor, incentive, structural cause, second-order effect, missing data point, or "what's still unresolved"). Do not re-litigate facts already on the table.`,
        `- "I agree with X and want to add Y" only works if Y is genuinely new substance, not a reworded Y' that's already there.`,
      ].join("\n"),
    );
  }
  lines.push(...buildFactCheckEvidenceBlock(packet.priorFactChecks, profileMap));
  lines.push(`Safety guardrail: ${packet.safetyGuardrail}`);
  lines.push(`Anchor instructions: ${anchor.instructions}`);
  if (packet.closingDirective) {
    lines.push("");
    lines.push("CLOSING SEGUE — overrides the goal/format directives above:");
    lines.push(packet.closingDirective);
  }
  return lines.filter(Boolean).join("\n");
}

function buildLiveUserPrompt(anchor: AnchorProfile, packet: PanelPacket) {
  const story = packet.storyPacket;
  const evidence = story.source_evidence.map((item, index) => ({
    index,
    channel: item.channel,
    lean: item.lean,
    timestamp: item.timestamp,
    note: item.note,
  }));

  return JSON.stringify(
    {
      anchor: {
        id: anchor.id,
        label: anchor.label,
      },
      selectedAnchors: packet.selectedAnchors,
      speakingOrder: packet.speakingOrder,
      debateConfig: packet.debateConfig,
      priorTranscriptExcerpts: packet.priorTranscriptExcerpts,
      responseGoal: packet.responseGoal,
      storyPacket: {
        id: story.id,
        story_id: story.story_id,
        title: story.title,
        topic: story.topic,
        sourceType: story.sourceType,
        sourceUpdatedAt: story.sourceUpdatedAt,
        event_time_window: story.event_time_window,
        neutral_summary: story.neutral_summary,
        left_framing_summary: story.left_framing_summary,
        right_framing_summary: story.right_framing_summary,
        consensus_points: story.consensus_points,
        divergence_points: story.divergence_points,
        sentiment_by_cluster: story.sentiment_by_cluster,
        keywords_spiking: story.keywords_spiking,
        ad_safety_state: story.ad_safety_state,
        confidence: story.confidence,
      },
      evidence,
      citationRequirements: {
        minimumEvidenceIndexes: evidence.length > 0 ? 1 : 0,
        maximumEvidenceIndexes: evidence.length > 0 ? Math.min(3, evidence.length) : 0,
      },
    },
    null,
    2,
  );
}

function buildArticleAnchorDirective(anchor: Pick<AnchorProfile, "id" | "label">) {
  if (anchor.id === "neutral") {
    return [
      `${anchor.label} explains the article clearly, separates fact from interpretation, and keeps uncertainty explicit.`,
      "When PRIOR TURNS exist, your reply MUST surface what's still unresolved between sources or what concrete signal would change the read. If both have already been covered, yield.",
    ].join(" ");
  }

  if (anchor.id === "left") {
    return [
      `${anchor.label} stays grounded to the article while emphasizing impacts, institutions, accountability, and who carries the burden inside the article's facts.`,
      "When PRIOR TURNS exist, your reply MUST surface a structural factor (policy, institution, access, who carries the cost) that prior speakers did NOT name. If you cannot name a fresh one grounded in the article, yield.",
    ].join(" ");
  }

  return [
    `${anchor.label} stays grounded to the article while emphasizing agency, incentives, public order, credibility, and what the article foregrounds inside the article's facts.`,
    "When PRIOR TURNS exist, your reply MUST surface an incentive or accountability angle (who gains, what behavior gets rewarded, where credibility is on the line) that prior speakers did NOT name. If you cannot name a fresh one grounded in the article, yield.",
  ].join(" ");
}

function buildArticleSystemPrompt(
  anchor: Pick<AnchorProfile, "id" | "label">,
  packet: StoryPacket,
  responseGoal: string,
  debateConfig?: DebateConfig,
  priorTranscriptExcerpts: PriorTranscriptExcerpt[] = [],
  sessionTranscript?: SessionTranscriptEntry[],
  priorFactChecks?: PriorFactCheck[],
) {
  const summaryDirective =
    responseGoal === "article_summary"
      ? "Open with the core development in one sentence; add one concrete detail or stake. No 'today', no 'in this article', no recap of what we just heard."
      : "Answer the follow-up directly in one sentence, grounded in the article. Skip throat-clearing and recaps.";

  const profileMap: Partial<Record<AnchorId, Pick<AnchorProfile, "label">>> = {
    [anchor.id]: { label: anchor.label },
  };
  for (const excerpt of priorTranscriptExcerpts) {
    if (!profileMap[excerpt.anchorId]) {
      profileMap[excerpt.anchorId] = { label: labelFor(excerpt.anchorId) };
    }
  }

  const lines: string[] = [
    `You are generating one short grounded on-air turn for ${anchor.label}.`,
    "Return only JSON that matches the required schema.",
    "Schema: { transcript: string, citedEvidenceIndexes: number[], yield?: { reason: string } }",
    "Use only the article metadata, article text, and evidence list provided in the user prompt.",
    "Never invent facts, citations, or events outside what the article supports.",
    "If the article does not support the answer, say so plainly — but do not mention the word 'article' more than once.",
    "Keep the transcript tight for speech: 1 to 2 sentences, under 50 words. No throat-clearing, no recaps, no meta. Lead with the point.",
    expressivenessDirective,
    buildArticleAnchorDirective(anchor),
    buildDebateToneGuidance(debateConfig?.tone ?? "balanced"),
    summaryDirective,
    `Response goal: ${responseGoal}.`,
  ];
  if (packet.confidence < 0.8) {
    lines.push("Explicitly note when the article support is limited or provisional.");
  }
  if (packet.ad_safety_state !== "safe") {
    lines.push("Avoid inflammatory phrasing and keep the tone restrained.");
  }
  lines.push(...buildSessionTranscriptBlock(anchor, sessionTranscript));
  if (priorTranscriptExcerpts.length > 0) {
    lines.push("");
    lines.push("PRIOR TURNS IN THIS PANEL (most recent last):");
    for (const excerpt of priorTranscriptExcerpts) {
      lines.push(`- ${labelFor(excerpt.anchorId, profileMap)}: "${clipText(excerpt.text, 220)}"`);
    }
    const last = priorTranscriptExcerpts[priorTranscriptExcerpts.length - 1];
    lines.push(
      [
        "FRESH-ANGLE REPLY RULE:",
        `- If your point is a paraphrase of any PRIOR TURN above — same claim, same caveat, same framing in different words — you MUST yield. Do not restate.`,
        `- Otherwise: name "${labelFor(last.anchorId, profileMap)}" by first name once, then deliver one specific facet the prior turns have not covered (a different actor, incentive, structural cause, second-order effect, missing data point, or "what's still unresolved"). Do not re-litigate facts already on the table.`,
        `- "I agree with X and want to add Y" only works if Y is genuinely new substance, not a reworded Y' that's already there.`,
      ].join("\n"),
    );
  }
  lines.push(...buildFactCheckEvidenceBlock(priorFactChecks, profileMap));
  return lines.filter(Boolean).join("\n");
}

function lensFramingFor(anchorId: AnchorId, packet: StoryPacket): string | undefined {
  if (anchorId === "left") return packet.left_framing_summary;
  if (anchorId === "right") return packet.right_framing_summary;
  return undefined;
}

function buildArticleUserPrompt(
  anchor: Pick<AnchorProfile, "id" | "label">,
  packet: StoryPacket,
  viewerPrompt: string,
  conversationContext?: Pick<PanelPacket, "selectedAnchors" | "speakingOrder" | "priorTranscriptExcerpts"> & {
    debateConfig?: DebateConfig;
  },
) {
  const lensFraming = lensFramingFor(anchor.id, packet);
  return JSON.stringify(
    {
      anchor: {
        id: anchor.id,
        label: anchor.label,
      },
      viewerPrompt,
      selectedAnchors: conversationContext?.selectedAnchors ?? [anchor.id],
      speakingOrder: conversationContext?.speakingOrder ?? [anchor.id],
      debateConfig: conversationContext?.debateConfig ?? {
        tone: "balanced",
        openingSpeaker: "auto",
        debateRounds: 1,
        includeModeratorBeat: true,
      },
      priorTranscriptExcerpts: conversationContext?.priorTranscriptExcerpts ?? [],
      article: {
        id: packet.id,
        story_id: packet.story_id,
        title: packet.sourceTitle ?? packet.title,
        summary: packet.neutral_summary,
        lensFraming,
        sourceUrl: packet.sourceUrl,
        sourceSiteName: packet.sourceSiteName,
        sourceDomain: packet.sourceDomain,
        sourceByline: packet.sourceByline,
        sourcePublishedAt: packet.sourcePublishedAt,
        articleBody: clipText(packet.articleBody ?? "", 8000),
      },
      evidence: packet.source_evidence.map((item, index) => ({
        index,
        channel: item.channel,
        lean: item.lean,
        timestamp: item.timestamp,
        note: item.note,
      })),
      citationRequirements: {
        minimumEvidenceIndexes: packet.source_evidence.length > 0 ? 1 : 0,
        maximumEvidenceIndexes: packet.source_evidence.length > 0 ? Math.min(3, packet.source_evidence.length) : 0,
      },
    },
    null,
    2,
  );
}

export interface BuiltLiveTurn {
  transcript: string;
  citedEvidence: SourceEvidence[];
  generationSource: Extract<GenerationSource, "openai" | "gemini">;
  yield?: LiveResponseYield;
}

export class LiveResponseBuilder {
  constructor(private readonly provider: LiveResponseProvider | null) {}

  getProvider(): LiveResponseProvider | null {
    return this.provider;
  }

  async buildTurn(
    anchor: AnchorProfile,
    packet: PanelPacket,
    override?: LiveResponseOverride,
  ): Promise<BuiltLiveTurn> {
    return this.generateStructuredTurn(
      buildLiveSystemPrompt(anchor, packet),
      buildLiveUserPrompt(anchor, packet),
      packet.storyPacket.source_evidence,
      override,
    );
  }

  async buildSuggestedPrompts(packet: StoryPacket): Promise<string[]> {
    if (!this.provider || !this.provider.available) {
      return [];
    }

    const systemPrompt = [
      "You generate suggested viewer follow-up questions for a live news desk.",
      "Return only JSON that matches the required schema.",
      "The `transcript` field must be a JSON-encoded array of 4 short prompt strings (e.g. \"[\\\"...\\\",\\\"...\\\"]\").",
      "Each prompt is at most 9 words, written as a viewer would type to a news anchor, with no leading numbering or quotes inside the string.",
      "Make each prompt specific to the provided story — reference an actual person, place, organization, claim, framing, or stake from the article rather than generic shells.",
      "Cover four different angles: (1) a person/entity named in the story, (2) the key evidence or claim, (3) the partisan split or both-sides framing, (4) what to watch next.",
      "Do not repeat phrasing across prompts. No hashtags. No emoji. End each prompt with a question mark or period.",
      "Set citedEvidenceIndexes to an empty array.",
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        story: {
          title: packet.sourceTitle ?? packet.title,
          topic: packet.topic,
          sourceType: packet.sourceType,
          sourceDomain: packet.sourceDomain,
          sourceByline: packet.sourceByline,
          keywords_spiking: packet.keywords_spiking,
          neutral_summary: packet.neutral_summary,
          left_framing_summary: packet.left_framing_summary,
          right_framing_summary: packet.right_framing_summary,
          consensus_points: packet.consensus_points,
          divergence_points: packet.divergence_points,
          articleSnippets: packet.articleSnippets ?? [],
          articleBody: clipText(packet.articleBody ?? "", 4000),
        },
      },
      null,
      2,
    );

    try {
      const result = await this.provider.generateTurn({ systemPrompt, userPrompt });
      const parsed = JSON.parse(result.transcript) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      const prompts = parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/\s+/g, " ").trim())
        .filter((entry) => entry.length > 0 && entry.length <= 120);
      const deduped = Array.from(new Set(prompts));
      return deduped.slice(0, 4);
    } catch (error) {
      console.warn("[liveResponseBuilder] suggested prompt generation failed", error);
      return [];
    }
  }

  async buildArticleFramings(packet: StoryPacket): Promise<{ left?: string; right?: string }> {
    if (!this.provider || !this.provider.available) {
      return {};
    }

    const systemPrompt = [
      "You produce two short, perspective-framed condensations of one article for a live news desk.",
      "Return only JSON that matches the required schema.",
      "The `transcript` field must be a JSON object with two keys, `left` and `right`, each holding a 2-3 sentence string under 520 characters.",
      "Hard rules for both framings:",
      "- Restate only facts present in the article. Do not introduce events, names, motives, or claims that the article does not contain.",
      "- Do not repeat the neutral summary verbatim. Each framing should emphasize what its lens would foreground, not invent new facts.",
      "- Do not include hedging boilerplate, role labels, or article meta-references (no 'the article says', 'according to the article').",
      "Left lens: emphasize impacts on workers and the public, institutions, accountability, equity, and who bears the burden.",
      "Right lens: emphasize individual agency, incentives, public order, credibility, and accountability of named actors.",
      "Set citedEvidenceIndexes to an empty array.",
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        article: {
          title: packet.sourceTitle ?? packet.title,
          sourceDomain: packet.sourceDomain,
          sourceByline: packet.sourceByline,
          neutralSummary: packet.neutral_summary,
          articleSnippets: packet.articleSnippets ?? [],
          articleBody: clipText(packet.articleBody ?? "", 6000),
        },
      },
      null,
      2,
    );

    try {
      const result = await this.provider.generateTurn({ systemPrompt, userPrompt });
      const parsed = JSON.parse(result.transcript) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      const obj = parsed as Record<string, unknown>;
      const left = typeof obj.left === "string" ? clipText(obj.left.replace(/\s+/g, " ").trim(), 520) : undefined;
      const right = typeof obj.right === "string" ? clipText(obj.right.replace(/\s+/g, " ").trim(), 520) : undefined;
      return { left: left || undefined, right: right || undefined };
    } catch (error) {
      console.warn("[liveResponseBuilder] article framings generation failed", error);
      return {};
    }
  }

  async buildArticleSummary(
    packet: StoryPacket,
    neutralProfile?: Pick<AnchorProfile, "id" | "label">,
    override?: LiveResponseOverride,
  ): Promise<BuiltLiveTurn> {
    const neutral = neutralProfile ?? { id: "neutral" as const, label: "Avery Quinn" };
    return this.generateStructuredTurn(
      buildArticleSystemPrompt(neutral, packet, "article_summary", undefined, []),
      buildArticleUserPrompt(
        neutral,
        packet,
        "Tell the story in a clear, engaging way. Lead with the main development, explain why it matters, and end with what to watch next.",
      ),
      packet.source_evidence,
      override,
    );
  }

  async buildArticleTurn(
    anchor: AnchorProfile,
    packet: StoryPacket,
    viewerPrompt: string,
    responseGoal: ResponseGoal,
    conversationContext?: Pick<PanelPacket, "selectedAnchors" | "speakingOrder" | "priorTranscriptExcerpts"> & {
      debateConfig?: DebateConfig;
      sessionTranscript?: SessionTranscriptEntry[];
      priorFactChecks?: PriorFactCheck[];
    },
    override?: LiveResponseOverride,
  ): Promise<BuiltLiveTurn> {
    return this.generateStructuredTurn(
      buildArticleSystemPrompt(
        anchor,
        packet,
        responseGoal,
        conversationContext?.debateConfig,
        conversationContext?.priorTranscriptExcerpts ?? [],
        conversationContext?.sessionTranscript,
        conversationContext?.priorFactChecks,
      ),
      buildArticleUserPrompt(anchor, packet, viewerPrompt, conversationContext),
      packet.source_evidence,
      override,
    );
  }

  private async generateStructuredTurn(
    systemPrompt: string,
    userPrompt: string,
    evidence: SourceEvidence[],
    override?: LiveResponseOverride,
  ): Promise<BuiltLiveTurn> {
    if (!this.provider || !this.provider.available) {
      throw new Error("Configured live response provider is unavailable.");
    }

    const result = await this.provider.generateTurn({
      systemPrompt,
      userPrompt,
      override,
    });

    const citedEvidence = uniqueIndexes(result.citedEvidenceIndexes, evidence.length).map((index) => evidence[index]);
    const isYield = Boolean(result.yield?.reason);
    // For yields, skip the boilerplate stripper — the handoff sentence is
    // intentionally short and may legitimately reference the anchor by name.
    const normalized = result.transcript.replace(/\s+/g, " ").trim();
    const cleaned = isYield ? normalized : stripBoilerplatePreamble(normalized);
    const transcript = clipText(cleaned, 280);
    if (transcript.length === 0) {
      throw new Error("Live response provider returned an empty transcript.");
    }

    return {
      transcript,
      citedEvidence,
      generationSource: this.provider.name,
      yield: result.yield,
    };
  }
}

export { buildLiveSystemPrompt, buildLiveUserPrompt, buildArticleSystemPrompt, buildArticleUserPrompt };
