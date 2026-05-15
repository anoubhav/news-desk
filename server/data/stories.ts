import type { StoryPacket } from "../../shared/models";

export const storyPackets: StoryPacket[] = [
  {
    id: "border-security-rally",
    story_id: "story-border-security-rally",
    title: "Border Security Rally Sparks Split Coverage",
    sourceType: "demo_story",
    event_time_window: "Last 45 seconds",
    topic: "border security rally",
    keywords_spiking: ["border", "turnout", "migrant crime", "humanitarian", "swing state"],
    neutral_summary:
      "Coverage surged after a border-security rally in Arizona, with both channel clusters focusing on turnout, campaign stakes, and whether the speech changes suburban voter sentiment.",
    left_framing_summary:
      "Left-leaning channels are emphasizing immigration rhetoric, humanitarian fallout, and how the campaign message lands with moderate and Latino voters.",
    right_framing_summary:
      "Right-leaning channels are emphasizing public safety, federal enforcement failures, and whether the rally sharpens the election contrast in key border states.",
    consensus_points: [
      "Both sides agree the rally is being treated as a battleground-state play.",
      "Both sides are tracking turnout optics and how the candidate performed on message discipline.",
    ],
    divergence_points: [
      "The left cluster frames the event as a test of tone and inclusiveness, while the right cluster frames it as a test of resolve and enforcement.",
      "Channels disagree on whether the rally broadened appeal or hardened the base.",
    ],
    sentiment_by_cluster: {
      neutral: "measured but urgent",
      left: "concerned",
      right: "energized",
    },
    ad_safety_state: "caution",
    confidence: 0.81,
    source_evidence: [
      {
        channel: "Metro News",
        lean: "left",
        timestamp: "2026-04-09T15:58:08Z",
        note: "Anchor discussion centered on tone, demographic persuasion, and humanitarian framing.",
      },
      {
        channel: "Frontline America",
        lean: "right",
        timestamp: "2026-04-09T15:58:19Z",
        note: "Panel emphasized deterrence, enforcement, and whether the speech set a stronger contrast frame.",
      },
      {
        channel: "Wire Pool",
        lean: "neutral",
        timestamp: "2026-04-09T15:58:27Z",
        note: "Straight recap focused on turnout, message discipline, and battleground implications.",
      },
    ],
  },
  {
    id: "debate-fact-check-surge",
    story_id: "story-debate-fact-check-surge",
    title: "Debate Fact-Check Segment Reorders the Night",
    sourceType: "demo_story",
    event_time_window: "Last 60 seconds",
    topic: "debate fact-check segment",
    keywords_spiking: ["fact-check", "moderator", "gaffe", "spin room", "swing voters"],
    neutral_summary:
      "A fact-check exchange from tonight’s Senate debate is now dominating coverage, pushing earlier economic clips off the front page and reframing the debate around credibility.",
    left_framing_summary:
      "Left-leaning channels are framing the moment as accountability theater that exposed evasiveness and made the moderator look stronger than the candidates.",
    right_framing_summary:
      "Right-leaning channels are framing the moment as selective moderation that changed the rules midstream and overshadowed policy substance.",
    consensus_points: [
      "Both clusters agree the fact-check clip overtook the rest of the debate conversation.",
      "Both sides are watching whether the clip reaches undecided voters through short-form redistribution.",
    ],
    divergence_points: [
      "The left cluster praises the intervention as clarifying. The right cluster frames it as editorial interference.",
      "Channels disagree on whether the viral moment helps the challenger or mainly hurts trust in the moderators.",
    ],
    sentiment_by_cluster: {
      neutral: "volatile",
      left: "validated",
      right: "combative",
    },
    ad_safety_state: "safe",
    confidence: 0.9,
    source_evidence: [
      {
        channel: "Capitol Forum",
        lean: "left",
        timestamp: "2026-04-09T16:01:15Z",
        note: "Panel highlighted credibility, evasiveness, and clip virality.",
      },
      {
        channel: "Liberty Night",
        lean: "right",
        timestamp: "2026-04-09T16:01:31Z",
        note: "Hosts argued the moderator inserted themselves into the debate and distorted substance.",
      },
      {
        channel: "National Wire",
        lean: "neutral",
        timestamp: "2026-04-09T16:01:42Z",
        note: "Wrap-up focused on clip reach, search spikes, and impact on the debate narrative.",
      },
    ],
  },
  {
    id: "campus-protest-escalation",
    story_id: "story-campus-protest-escalation",
    title: "Campus Protest Escalation Pushes Safety Risk Higher",
    sourceType: "demo_story",
    event_time_window: "Last 30 seconds",
    topic: "campus protest escalation",
    keywords_spiking: ["arrests", "riot police", "counterprotest", "encampment", "violence"],
    neutral_summary:
      "Live feeds are pivoting hard toward a campus protest escalation after arrests and a visible police perimeter changed the tone from policy debate to public-order coverage.",
    left_framing_summary:
      "Left-leaning channels are focusing on protest rights, policing tactics, and the risk that the response becomes the bigger story than the protest itself.",
    right_framing_summary:
      "Right-leaning channels are focusing on disorder, campus leadership failures, and whether the unrest confirms a broader law-and-order campaign message.",
    consensus_points: [
      "Both clusters agree the visuals changed the story from policy to confrontation.",
      "Both sides are prioritizing the live images over broader issue background.",
    ],
    divergence_points: [
      "The left cluster frames police response as the core escalation; the right cluster frames protester conduct as the core escalation.",
      "Channels disagree on whether the footage should be treated as civil-liberties reporting or a public-order flashpoint.",
    ],
    sentiment_by_cluster: {
      neutral: "tense",
      left: "alarmed",
      right: "hardline",
    },
    ad_safety_state: "unsafe",
    confidence: 0.74,
    source_evidence: [
      {
        channel: "Cityline",
        lean: "left",
        timestamp: "2026-04-09T16:03:04Z",
        note: "Live commentary stressed protest rights and police posture.",
      },
      {
        channel: "Patriot Desk",
        lean: "right",
        timestamp: "2026-04-09T16:03:12Z",
        note: "Commentary focused on disorder and campus leadership responsibility.",
      },
      {
        channel: "Wire Pool",
        lean: "neutral",
        timestamp: "2026-04-09T16:03:18Z",
        note: "Neutral feed focused on arrests, police perimeter, and shifting visuals.",
      },
    ],
  },
];
