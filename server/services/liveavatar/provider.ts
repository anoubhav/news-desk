import type { AnchorId, AnchorProfile, AnchorSession, ProviderMode, SessionEvent } from "../../../shared/models";

export interface SessionSeed {
  anchorId: AnchorId;
  sessionId: string;
  providerMode: ProviderMode;
  sandbox: boolean;
  sessionAccessToken?: string;
  resolvedAvatarId?: string;
  resolvedVoiceId?: string;
  resolvedContextId?: string;
}

export interface FullModeProvider {
  readonly mode: ProviderMode;
  createSession(profile: AnchorProfile): Promise<SessionSeed>;
  speakText(session: AnchorSession, text: string): Promise<SessionEvent[]>;
  stopSession(session: AnchorSession): Promise<void>;
}
