import type { AnchorProfile, AnchorSession, SessionEvent } from "../../../shared/models";
import type { FullModeProvider, SessionSeed } from "./provider";

function buildId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class MockLiveAvatarProvider implements FullModeProvider {
  readonly mode = "mock" as const;

  async createSession(_profile: AnchorProfile): Promise<SessionSeed> {
    return {
      anchorId: _profile.id,
      sessionId: buildId(`mock-${_profile.id}`),
      providerMode: this.mode,
      sandbox: true,
    };
  }

  async speakText(session: AnchorSession, text: string): Promise<SessionEvent[]> {
    const startedId = buildId("evt");
    const endedId = buildId("evt");
    const now = new Date().toISOString();

    return [
      {
        id: startedId,
        anchorId: session.anchorId,
        eventType: "avatar.speak_started",
        timestamp: now,
      },
      {
        id: buildId("evt"),
        anchorId: session.anchorId,
        eventType: "avatar.transcription",
        text,
        timestamp: now,
        sourceEventId: startedId,
      },
      {
        id: endedId,
        anchorId: session.anchorId,
        eventType: "avatar.speak_ended",
        timestamp: now,
        sourceEventId: startedId,
      },
    ];
  }

  async stopSession(_session: AnchorSession): Promise<void> {
    return;
  }
}
