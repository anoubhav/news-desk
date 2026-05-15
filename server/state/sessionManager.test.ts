import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorId, AnchorProfile } from "../../shared/models";
import { anchorProfiles } from "../data/anchors";
import { MockLiveAvatarProvider } from "../services/liveavatar/mockLiveAvatarProvider";
import { AnchorSessionManager } from "./sessionManager";

function buildProfileMap() {
  return Object.fromEntries(anchorProfiles.map((profile) => [profile.id, profile])) as Record<
    AnchorId,
    AnchorProfile
  >;
}

describe("AnchorSessionManager", () => {
  let manager: AnchorSessionManager;

  beforeEach(() => {
    manager = new AnchorSessionManager(new MockLiveAvatarProvider(), buildProfileMap());
  });

  it("prewarms neutral on initialize", async () => {
    await manager.initialize();

    const sessions = manager.getSessions();
    expect(sessions.neutral.status).toBe("ready");
    expect(sessions.neutral.prewarmed).toBe(true);
    expect(sessions.left.status).toBe("idle");
    expect(sessions.right.status).toBe("idle");
  });

  it("lazy starts side anchors and preserves their sessions after deselection", async () => {
    await manager.initialize();
    const firstSync = await manager.syncSelectedAnchors(["neutral", "left"]);
    const leftSessionId = firstSync.left.sessionId;

    expect(firstSync.left.status).toBe("ready");
    expect(firstSync.left.isSelected).toBe(true);
    expect(firstSync.left.lazy).toBe(true);

    const secondSync = await manager.syncSelectedAnchors(["neutral"]);
    expect(secondSync.left.sessionId).toBe(leftSessionId);
    expect(secondSync.left.isSelected).toBe(false);
    expect(secondSync.left.status).toBe("ready");
  });

  it("applies relayed browser events to session state", async () => {
    await manager.initialize();
    await manager.syncSelectedAnchors(["neutral", "left"]);
    const session = manager.getSession("neutral");

    const ready = manager.applyBrowserEvent("neutral", session.sessionId, {
      type: "session.stream_ready",
      timestamp: "2026-04-10T09:00:00Z",
    });
    const started = manager.applyBrowserEvent("neutral", session.sessionId, {
      type: "avatar.speak_started",
      timestamp: "2026-04-10T09:00:01Z",
      eventId: "evt-1",
    });
    const transcription = manager.applyBrowserEvent("neutral", session.sessionId, {
      type: "avatar.transcription",
      timestamp: "2026-04-10T09:00:02Z",
      eventId: "evt-2",
      sourceEventId: "evt-1",
      text: "Real relayed transcript.",
    });
    const ended = manager.applyBrowserEvent("neutral", session.sessionId, {
      type: "avatar.speak_ended",
      timestamp: "2026-04-10T09:00:03Z",
      eventId: "evt-3",
      sourceEventId: "evt-1",
    });

    expect(ready.accepted).toBe(true);
    expect(started.accepted).toBe(true);
    expect(transcription.session.transcript).toBe("Real relayed transcript.");
    expect(ended.session.status).toBe("ready");
    expect(ended.session.lastEventType).toBe("avatar.speak_ended");
  });

  it("ignores stale session ids and duplicate events", async () => {
    await manager.initialize();
    const session = manager.getSession("neutral");

    const stale = manager.applyBrowserEvent("neutral", "neutral-old", {
      type: "session.stream_ready",
      timestamp: "2026-04-10T09:00:00Z",
    });
    const first = manager.applyBrowserEvent("neutral", session.sessionId, {
      type: "avatar.speak_started",
      timestamp: "2026-04-10T09:00:01Z",
      eventId: "evt-1",
    });
    const duplicate = manager.applyBrowserEvent("neutral", session.sessionId, {
      type: "avatar.speak_started",
      timestamp: "2026-04-10T09:00:02Z",
      eventId: "evt-1",
    });

    expect(stale.accepted).toBe(false);
    expect(stale.ignoredReason).toBe("stale_session");
    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.ignoredReason).toBe("duplicate_event");
  });

  it("keeps full-api selections in standby until one anchor is explicitly activated", async () => {
    const provider = {
      mode: "full-api" as const,
      createSession: vi.fn(async (profile: AnchorProfile) => ({
        anchorId: profile.id,
        sessionId: `${profile.id}-session`,
        providerMode: "full-api" as const,
        sandbox: true,
        sessionAccessToken: `${profile.id}-token`,
      })),
      speakText: vi.fn(async () => []),
      stopSession: vi.fn(async () => undefined),
    };
    const fullApiManager = new AnchorSessionManager(provider, buildProfileMap());

    await fullApiManager.initialize();
    expect(fullApiManager.getSessions().neutral.status).toBe("standby");
    expect(provider.createSession).not.toHaveBeenCalled();

    const synced = await fullApiManager.syncSelectedAnchors(["neutral", "left"]);
    expect(synced.neutral.status).toBe("standby");
    expect(synced.left.status).toBe("standby");
    expect(provider.createSession).not.toHaveBeenCalled();

    const leftSession = await fullApiManager.refreshAnchor("left", { selected: true });
    expect(provider.createSession).toHaveBeenCalledTimes(1);
    expect(leftSession.sessionAccessToken).toBe("left-token");
    expect(fullApiManager.getSessions().neutral.status).toBe("standby");
    expect(fullApiManager.getSessions().right.status).toBe("idle");
  });

  it("keeps the prior selected full-api session warm when activating an additional presenter", async () => {
    const provider = {
      mode: "full-api" as const,
      createSession: vi.fn(async (profile: AnchorProfile) => ({
        anchorId: profile.id,
        sessionId: `${profile.id}-session`,
        providerMode: "full-api" as const,
        sandbox: true,
        sessionAccessToken: `${profile.id}-token`,
      })),
      speakText: vi.fn(async () => []),
      stopSession: vi.fn(async () => undefined),
    };
    const fullApiManager = new AnchorSessionManager(provider, buildProfileMap());

    await fullApiManager.initialize();
    await fullApiManager.syncSelectedAnchors(["neutral", "left"]);
    await fullApiManager.refreshAnchor("neutral", { selected: true });

    // With three concurrent sessions on the premium plan, neutral's live token
    // must survive when left is activated next — no stopSession call for a
    // still-selected presenter that already has a token.
    provider.stopSession.mockClear();

    await fullApiManager.refreshAnchor("left", { selected: true });

    const stoppedLiveNeutral = (provider.stopSession.mock.calls as unknown as Array<[{ anchorId: AnchorId; sessionAccessToken?: string }]>).some(
      ([session]) => session.anchorId === "neutral" && Boolean(session.sessionAccessToken),
    );
    expect(stoppedLiveNeutral).toBe(false);
    expect(fullApiManager.getSessions().neutral.sessionAccessToken).toBe("neutral-token");
    expect(fullApiManager.getSessions().left.sessionAccessToken).toBe("left-token");
  });
});
