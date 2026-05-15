import type {
  AnchorId,
  AnchorProfile,
  AnchorSession,
  BrowserSessionEvent,
  RelaySessionEventResponse,
  SessionEvent,
} from "../../shared/models";
import { anchorIds } from "../../shared/models";
import type { FullModeProvider } from "../services/liveavatar/provider";

function timestamp() {
  return new Date().toISOString();
}

function hasEventId(event: BrowserSessionEvent): event is Extract<BrowserSessionEvent, { eventId: string }> {
  return "eventId" in event && typeof event.eventId === "string" && event.eventId.length > 0;
}

export class AnchorSessionManager {
  private readonly sessions = new Map<AnchorId, AnchorSession>();
  private readonly seenEventIds = new Map<AnchorId, Set<string>>();
  private readonly activeSpeechIds = new Map<AnchorId, string | undefined>();

  constructor(
    private readonly provider: FullModeProvider,
    private readonly profiles: Record<AnchorId, AnchorProfile>,
  ) {}

  async initialize(): Promise<void> {
    if (this.provider.mode === "full-api") {
      await this.syncFullApiSelection(["neutral"]);
      return;
    }

    await this.ensureSession("neutral", { prewarmed: true, selected: true });
  }

  async refreshSelectedAnchors(
    selectedAnchors: AnchorId[],
    profileOverrides?: Partial<Record<AnchorId, AnchorProfile>>,
  ): Promise<Record<AnchorId, AnchorSession>> {
    if (this.provider.mode === "full-api") {
      void profileOverrides;
      await this.syncFullApiSelection(selectedAnchors);
      return this.getSessions();
    }

    for (const anchorId of selectedAnchors) {
      await this.refreshAnchor(
        anchorId,
        {
          prewarmed: anchorId === "neutral",
          selected: true,
        },
        profileOverrides?.[anchorId],
      );
    }

    for (const anchorId of anchorIds) {
      const session = this.sessions.get(anchorId);
      if (!session) {
        continue;
      }

      session.isSelected = selectedAnchors.includes(anchorId);
      session.updatedAt = timestamp();
    }

    return this.getSessions();
  }

  async refreshAnchor(
    anchorId: AnchorId,
    options?: { prewarmed?: boolean; selected?: boolean },
    profileOverride?: AnchorProfile,
  ): Promise<AnchorSession> {
    if (this.provider.mode === "full-api") {
      const currentSessions = this.getSessions();
      const nextSelection = anchorIds.filter((candidateId) =>
        candidateId === anchorId
          ? options?.selected ?? currentSessions[candidateId].isSelected
          : currentSessions[candidateId].isSelected,
      );

      await this.syncFullApiSelection(nextSelection);

      return this.replaceSession(
        anchorId,
        {
          prewarmed: false,
          selected: nextSelection.includes(anchorId),
        },
        profileOverride,
      );
    }

    return this.replaceSession(
      anchorId,
      {
        prewarmed: options?.prewarmed ?? anchorId === "neutral",
        selected: options?.selected ?? true,
      },
      profileOverride,
    );
  }

  getSession(anchorId: AnchorId): AnchorSession {
    const session = this.sessions.get(anchorId);
    if (!session) {
      throw new Error(`Session missing for ${anchorId}`);
    }
    return session;
  }

  getProfile(anchorId: AnchorId): AnchorProfile {
    return this.profiles[anchorId];
  }

  async invalidateSession(anchorId: AnchorId): Promise<void> {
    const existing = this.sessions.get(anchorId);
    if (!existing) return;
    if (existing.sessionAccessToken) {
      await this.provider.stopSession(existing).catch(() => undefined);
    }
    this.sessions.delete(anchorId);
    this.resetRuntimeState(anchorId);
  }

  applyRuntimeOverrides(
    overrides: Partial<Record<AnchorId, { avatarId?: string; voiceId?: string }>>,
  ): AnchorId[] {
    const changed: AnchorId[] = [];
    for (const anchorId of anchorIds) {
      const override = overrides[anchorId];
      if (!override) {
        continue;
      }
      const profile = this.profiles[anchorId];
      const before = `${profile.runtime.avatarId ?? ""}|${profile.runtime.voiceId ?? ""}`;
      if (typeof override.avatarId === "string") {
        profile.runtime.avatarId = override.avatarId.trim() || undefined;
      }
      if (typeof override.voiceId === "string") {
        profile.runtime.voiceId = override.voiceId.trim() || undefined;
      }
      const after = `${profile.runtime.avatarId ?? ""}|${profile.runtime.voiceId ?? ""}`;
      if (before !== after) {
        changed.push(anchorId);
      }
    }
    return changed;
  }

  getSessions(): Record<AnchorId, AnchorSession> {
    return anchorIds.reduce(
      (accumulator, anchorId) => {
        const session =
          this.sessions.get(anchorId) ??
          this.buildIdleSession(anchorId, {
            prewarmed: this.provider.mode === "mock" && anchorId === "neutral",
            selected: anchorId === "neutral",
          });
        accumulator[anchorId] = session;
        return accumulator;
      },
      {} as Record<AnchorId, AnchorSession>,
    );
  }

  async syncSelectedAnchors(selectedAnchors: AnchorId[]): Promise<Record<AnchorId, AnchorSession>> {
    if (this.provider.mode === "full-api") {
      await this.syncFullApiSelection(selectedAnchors);
      return this.getSessions();
    }

    await this.ensureSession("neutral", {
      prewarmed: true,
      selected: selectedAnchors.includes("neutral"),
    });

    for (const anchorId of selectedAnchors) {
      if (anchorId === "neutral") {
        continue;
      }
      await this.ensureSession(anchorId, { prewarmed: false, selected: true });
    }

    for (const anchorId of anchorIds) {
      const session = this.sessions.get(anchorId);
      if (!session) {
        continue;
      }
      session.isSelected = selectedAnchors.includes(anchorId);
      session.updatedAt = timestamp();
    }

    return this.getSessions();
  }

  async speak(anchorId: AnchorId, transcript: string): Promise<SessionEvent[]> {
    const activeSession = this.getSession(anchorId);

    if (this.provider.mode === "full-api") {
      void transcript;
      void activeSession;
      return [];
    }

    for (const [otherAnchorId, session] of this.sessions.entries()) {
      if (otherAnchorId !== anchorId && session.status !== "stopped") {
        session.status = "ready";
        session.updatedAt = timestamp();
      }
    }

    activeSession.status = "speaking";
    activeSession.updatedAt = timestamp();

    const events = await this.provider.speakText(activeSession, transcript);
    activeSession.status = "ready";
    activeSession.transcript = transcript;
    activeSession.lastEventType = "avatar.speak_ended";
    activeSession.updatedAt = timestamp();

    return events;
  }

  applyBrowserEvent(
    anchorId: AnchorId,
    sessionId: string,
    event: BrowserSessionEvent,
  ): RelaySessionEventResponse {
    let session = this.sessions.get(anchorId);
    if (!session) {
      return {
        accepted: false,
        ignoredReason: "unknown_anchor",
        session: this.buildIdleSession(anchorId, {
          prewarmed: false,
          selected: false,
        }),
      };
    }

    if (session.sessionId !== sessionId) {
      return {
        accepted: false,
        ignoredReason: "stale_session",
        session,
      };
    }

    if (hasEventId(event)) {
      const seen = this.getSeenEventIds(anchorId);
      if (seen.has(event.eventId)) {
        return {
          accepted: false,
          ignoredReason: "duplicate_event",
          session,
        };
      }
      seen.add(event.eventId);
    }

    const activeSpeechId = this.activeSpeechIds.get(anchorId);
    if (
      (event.type === "avatar.transcription" || event.type === "avatar.speak_ended") &&
      event.sourceEventId &&
      activeSpeechId &&
      event.sourceEventId !== activeSpeechId
    ) {
      return {
        accepted: false,
        ignoredReason: "out_of_order",
        session,
      };
    }

    switch (event.type) {
      case "session.stream_ready": {
        session.liveReady = true;
        session.startupError = undefined;
        if (session.status === "connecting" || session.status === "stopped" || session.status === "standby") {
          session.status = "ready";
        }
        break;
      }
      case "avatar.speak_started": {
        for (const [otherAnchorId, otherSession] of this.sessions.entries()) {
          if (otherAnchorId !== anchorId && otherSession.status !== "stopped") {
            otherSession.status =
              this.provider.mode === "full-api"
                ? otherSession.isSelected
                  ? "standby"
                  : "idle"
                : "ready";
            otherSession.updatedAt = event.timestamp;
          }
        }

        session.status = "speaking";
        session.lastEventType = "avatar.speak_started";
        this.activeSpeechIds.set(anchorId, event.eventId);
        break;
      }
      case "avatar.transcription": {
        session.transcript = event.text;
        session.lastEventType = "avatar.transcription";
        if (session.status !== "ready") {
          session.status = "speaking";
        }
        break;
      }
      case "avatar.speak_ended": {
        session.lastEventType = "avatar.speak_ended";
        if (!event.sourceEventId || !activeSpeechId || event.sourceEventId === activeSpeechId) {
          session.status = "ready";
          this.activeSpeechIds.delete(anchorId);
        }
        break;
      }
      case "session.disconnected": {
        session = this.applyStoppedEvent(anchorId, session, event.reason);
        break;
      }
      case "session.stopped": {
        session = this.applyStoppedEvent(anchorId, session, event.stopReason);
        break;
      }
      case "client.runtime_error": {
        session.startupError = event.message;
        if (event.phase === "start" || event.phase === "stream_wait") {
          session.liveReady = false;
          session.status = "stopped";
          session.sessionAccessToken = undefined;
        } else if (session.status === "connecting") {
          session.status = "stopped";
        }
        break;
      }
    }

    session.updatedAt = event.timestamp;

    return {
      accepted: true,
      session,
    };
  }

  private async syncFullApiSelection(selectedAnchors: AnchorId[]) {
    const selected = new Set(selectedAnchors);

    for (const anchorId of anchorIds) {
      const existing = this.sessions.get(anchorId);
      const stillSelected = selected.has(anchorId);

      // Anchor staying selected with a live token: keep the existing session intact.
      // The browser-side RTC session continues uninterrupted; switching speakers
      // is then just a state transition (standby → speaking → standby), not a
      // session teardown.
      if (stillSelected && existing?.sessionAccessToken) {
        existing.isSelected = true;
        existing.updatedAt = timestamp();
        continue;
      }

      // Anchor leaving the selection — stop its provider session.
      if (!stillSelected && existing?.sessionAccessToken) {
        await this.provider.stopSession(existing).catch(() => undefined);
      }

      // Anchor either entering the selection (no prior session) or being
      // deselected — install a fresh placeholder.
      this.sessions.set(
        anchorId,
        this.buildIdleSession(
          anchorId,
          {
            prewarmed: false,
            selected: stillSelected,
            status: stillSelected ? "standby" : "idle",
          },
          existing,
        ),
      );
      this.resetRuntimeState(anchorId);
    }
  }

  private applyStoppedEvent(anchorId: AnchorId, session: AnchorSession, reason: string) {
    const serverInitiated = reason === "SERVER_INITIATED";
    const wasSpeaking = this.activeSpeechIds.has(anchorId) || session.status === "speaking";
    this.activeSpeechIds.delete(anchorId);

    if (wasSpeaking) {
      console.warn(
        `[liveavatar] session stopped reason=${reason} anchorId=${anchorId} wasSpeaking=true previousStatus=${session.status} sessionId=${session.sessionId ?? "(none)"}`,
      );
    }

    if (this.provider.mode === "full-api" && serverInitiated) {
      const placeholder = this.buildIdleSession(
        anchorId,
        {
          prewarmed: false,
          selected: session.isSelected,
          status: session.isSelected ? "standby" : "idle",
        },
        session,
      );
      this.sessions.set(anchorId, placeholder);
      this.resetRuntimeState(anchorId);
      return placeholder;
    }

    session.status = "stopped";
    session.liveReady = false;
    session.startupError = serverInitiated ? undefined : reason;
    session.sessionAccessToken = undefined;
    return session;
  }

  private async ensureSession(
    anchorId: AnchorId,
    options: { prewarmed: boolean; selected: boolean },
    profileOverride?: AnchorProfile,
  ): Promise<AnchorSession> {
    const existing = this.sessions.get(anchorId);
    if (existing) {
      existing.prewarmed = existing.prewarmed || options.prewarmed;
      existing.isSelected = options.selected;
      existing.updatedAt = timestamp();
      return existing;
    }

    const profile = profileOverride ?? this.profiles[anchorId];
    const now = timestamp();
    const connecting = this.buildIdleSession(anchorId, {
      prewarmed: options.prewarmed,
      selected: options.selected,
      status: this.provider.mode === "full-api" ? "connecting" : "idle",
    });
    this.sessions.set(anchorId, connecting);

    try {
      const seed = await this.provider.createSession(profile);
      const readySession: AnchorSession = {
        anchorId,
        sessionId: seed.sessionId,
        status: seed.providerMode === "full-api" ? "connecting" : "ready",
        providerMode: seed.providerMode,
        prewarmed: options.prewarmed,
        lazy: anchorId !== "neutral",
        transcript: "",
        createdAt: now,
        updatedAt: now,
        sandbox: seed.sandbox,
        isSelected: options.selected,
        sessionAccessToken: seed.sessionAccessToken,
        resolvedAvatarId: seed.resolvedAvatarId,
        resolvedVoiceId: seed.resolvedVoiceId,
        resolvedContextId: seed.resolvedContextId,
        liveReady: seed.providerMode === "mock",
      };
      this.sessions.set(anchorId, readySession);
      this.resetRuntimeState(anchorId);
      return readySession;
    } catch (error) {
      const failedSession: AnchorSession = {
        ...connecting,
        status: "stopped",
        startupError: error instanceof Error ? error.message : "Unknown startup error",
      };
      this.sessions.set(anchorId, failedSession);
      this.resetRuntimeState(anchorId);
      return failedSession;
    }
  }

  private async replaceSession(
    anchorId: AnchorId,
    options: { prewarmed: boolean; selected: boolean },
    profileOverride?: AnchorProfile,
  ): Promise<AnchorSession> {
    const existing = this.sessions.get(anchorId);
    if (existing) {
      await this.provider.stopSession(existing).catch(() => undefined);
      this.sessions.delete(anchorId);
      this.resetRuntimeState(anchorId);
    }

    return this.ensureSession(anchorId, options, profileOverride);
  }

  private buildIdleSession(
    anchorId: AnchorId,
    options: { prewarmed: boolean; selected: boolean; status?: AnchorSession["status"] },
    existing?: AnchorSession,
  ): AnchorSession {
    const now = timestamp();
    const status =
      options.status ??
      (this.provider.mode === "full-api" ? (options.selected ? "standby" : "idle") : options.selected ? "ready" : "idle");

    return {
      anchorId,
      sessionId: status === "standby" ? `${anchorId}-standby` : `${anchorId}-idle`,
      status,
      providerMode: this.provider.mode,
      prewarmed: this.provider.mode === "full-api" ? false : options.prewarmed,
      lazy: anchorId !== "neutral",
      transcript: existing?.transcript ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastEventType: existing?.lastEventType,
      sandbox: existing?.sandbox ?? true,
      isSelected: options.selected,
      liveReady: false,
    };
  }

  private resetRuntimeState(anchorId: AnchorId) {
    this.seenEventIds.set(anchorId, new Set<string>());
    this.activeSpeechIds.delete(anchorId);
  }

  private getSeenEventIds(anchorId: AnchorId) {
    let seen = this.seenEventIds.get(anchorId);
    if (!seen) {
      seen = new Set<string>();
      this.seenEventIds.set(anchorId, seen);
    }
    return seen;
  }
}
