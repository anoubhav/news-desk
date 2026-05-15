// One-off smoke check for the debate engine overhaul.
// Run: npx tsx scripts/smoke_debate.mts
import { routeViewerPrompt, orchestratePanel, normalizeDebateConfig } from "../server/services/orchestrator.ts";
import { anchorProfiles } from "../server/data/anchors.ts";
import { storyPackets } from "../server/data/stories.ts";
import { AnchorSessionManager } from "../server/state/sessionManager.ts";
import { MockLiveAvatarProvider } from "../server/services/liveavatar/mockLiveAvatarProvider.ts";
import type { AnchorId, AnchorProfile } from "../shared/models.ts";

const profileMap = Object.fromEntries(anchorProfiles.map((p) => [p.id, p])) as Record<AnchorId, AnchorProfile>;

console.log("=== Routing smoke ===");
for (const prompt of [
  "What does Left think about this?",
  "How do left and right differ on healthcare?",
  "Catch me up",
  "Debate this",
  "What changed?",
]) {
  console.log(JSON.stringify({ prompt, route: routeViewerPrompt(prompt) }));
}

console.log("\n=== 3-anchor / 2-round / moderator-beat smoke ===");
const sm = new AnchorSessionManager(new MockLiveAvatarProvider(), profileMap);
await sm.initialize();
await sm.syncSelectedAnchors(["neutral", "left", "right"]);

const turns = await orchestratePanel({
  selectedAnchors: ["neutral", "left", "right"],
  // Generic prompt that does NOT trigger any speakers/rounds override — we exercise the
  // multi-round + moderator-beat path purely via the explicit debateConfig.
  viewerPrompt: "Walk us through this story.",
  storyPacket: storyPackets[0],
  anchorProfiles: profileMap,
  sessionManager: sm,
  debateConfig: { debateRounds: 2, includeModeratorBeat: true },
});

for (const t of turns) {
  const tag = t.isModeratorBeat ? "[MOD]" : "     ";
  console.log(
    `${tag} round=${t.roundIndex} ${t.anchorId.padEnd(7)} reply→${t.replyToAnchorId ?? "-"}  goal=${t.responseGoal}`,
  );
  console.log(`        ${t.transcript.slice(0, 130)}${t.transcript.length > 130 ? "..." : ""}`);
}

console.log("\n=== Direct-address: 'What does Left think?' (caller selected all 3) ===");
const sm2 = new AnchorSessionManager(new MockLiveAvatarProvider(), profileMap);
await sm2.initialize();
await sm2.syncSelectedAnchors(["neutral", "left", "right"]);
const directTurns = await orchestratePanel({
  selectedAnchors: ["neutral", "left", "right"],
  viewerPrompt: "What does Left think about this?",
  storyPacket: storyPackets[0],
  anchorProfiles: profileMap,
  sessionManager: sm2,
});
console.log(`turns: ${directTurns.length} | anchors: ${directTurns.map((t) => t.anchorId).join(", ")}`);

console.log("\n=== Normalize defaults ===");
console.log(JSON.stringify(normalizeDebateConfig()));
console.log(JSON.stringify(normalizeDebateConfig({ debateRounds: 3 })));

process.exit(0);
