import {
  AgentEventsEnum,
  CommandEventsEnum,
  LiveAvatarSession,
  SessionEvent as LiveSessionEvent,
  VoiceChatEvent,
  VoiceChatState,
  type VoiceChatConfig,
} from "@heygen/liveavatar-web-sdk";

const liveKitCommandTopic = "agent-control";

interface LiveKitPublisher {
  publishData: (data: Uint8Array, options: { reliable: boolean; topic: string }) => Promise<void> | void;
}

interface LiveAvatarSessionInternals {
  room?: {
    localParticipant?: LiveKitPublisher;
  };
  _remoteAudioTrack?: {
    mediaStreamTrack?: MediaStreamTrack;
  };
  _remoteVideoTrack?: {
    mediaStreamTrack?: MediaStreamTrack;
  };
}

interface VoiceChatController {
  state: VoiceChatState;
  start: (config?: VoiceChatConfig) => Promise<void> | void;
  mute: () => Promise<void> | void;
  unmute: () => Promise<void> | void;
}

function buildEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `evt-${Math.random().toString(36).slice(2, 10)}`;
}

function withTimeout<T>(operation: Promise<T> | T, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(operation)
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function speakTextOverLiveKit(session: LiveAvatarSession, transcript: string) {
  const publisher = (session as unknown as LiveAvatarSessionInternals).room?.localParticipant;
  if (!publisher) {
    return session.repeat(transcript);
  }

  const eventId = buildEventId();
  const payload = {
    event_id: eventId,
    event_type: CommandEventsEnum.AVATAR_SPEAK_TEXT,
    text: transcript,
  };
  const data = new TextEncoder().encode(JSON.stringify(payload));

  await publisher.publishData(data, {
    reliable: true,
    topic: liveKitCommandTopic,
  });

  return eventId;
}

export async function createBrowserLiveSession(
  sessionAccessToken: string,
  options?: { voiceChat?: VoiceChatConfig | boolean },
  prepare?: (session: LiveAvatarSession) => void | Promise<void>,
) {
  const session = new LiveAvatarSession(sessionAccessToken, {
    voiceChat: options?.voiceChat ?? false,
  });

  await prepare?.(session);
  await session.start();
  return session;
}

export async function waitForStreamReady(session: LiveAvatarSession, timeoutMs = 12000) {
  const internals = session as unknown as LiveAvatarSessionInternals;
  if (internals._remoteAudioTrack?.mediaStreamTrack && internals._remoteVideoTrack?.mediaStreamTrack) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.clearInterval(poll);
      session.off(LiveSessionEvent.SESSION_STREAM_READY, handleReady);
      reject(new Error("Timed out waiting for LiveAvatar media stream"));
    }, timeoutMs);

    const handleReady = () => {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      session.off(LiveSessionEvent.SESSION_STREAM_READY, handleReady);
      resolve();
    };

    const poll = window.setInterval(() => {
      if (internals._remoteAudioTrack?.mediaStreamTrack && internals._remoteVideoTrack?.mediaStreamTrack) {
        handleReady();
      }
    }, 150);

    session.on(LiveSessionEvent.SESSION_STREAM_READY, handleReady);
  });
}

export async function startVoiceCapture(session: LiveAvatarSession) {
  const voiceChat = session.voiceChat as unknown as VoiceChatController;

  if (voiceChat.state !== VoiceChatState.ACTIVE) {
    await withTimeout(
      voiceChat.start({
        defaultMuted: true,
      }),
      10000,
      "Timed out starting the microphone.",
    );
  }

  await withTimeout(
    voiceChat.unmute(),
    4000,
    "Timed out enabling live microphone capture.",
  );
}

export async function stopVoiceCapture(session: LiveAvatarSession) {
  const voiceChat = session.voiceChat as unknown as VoiceChatController;
  if (voiceChat.state !== VoiceChatState.ACTIVE) {
    return;
  }

  await withTimeout(
    voiceChat.mute(),
    4000,
    "Timed out disabling live microphone capture.",
  );
}

export function interruptSession(session: LiveAvatarSession) {
  session.interrupt();
}

export interface PlaybackResult {
  // "ended" = SDK fired AVATAR_SPEAK_ENDED for our command and the elapsed time looked real.
  // "ended-too-fast" = SDK ended in <1500ms; almost certainly the avatar didn't actually speak.
  //   Surfaced as a distinct outcome so the caller can treat it as a failure and retry.
  // "timeout" = no AVATAR_SPEAK_ENDED within the wait window.
  // "error" = publishData itself threw before the avatar got the speak command.
  outcome: "ended" | "ended-too-fast" | "timeout" | "error";
  commandEventId?: string;
  elapsedMs: number;
  message?: string;
}

export async function repeatAndWait(session: LiveAvatarSession, transcript: string): Promise<PlaybackResult> {
  const startedAt = Date.now();
  let commandEventId: string | undefined;
  try {
    commandEventId = await speakTextOverLiveKit(session, transcript);
  } catch (error) {
    return {
      outcome: "error",
      commandEventId,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Failed to send speak command.",
    };
  }

  return await new Promise<PlaybackResult>((resolve) => {
    const timeout = window.setTimeout(() => {
      session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleEnded);
      resolve({ outcome: "timeout", commandEventId, elapsedMs: Date.now() - startedAt });
    }, 300000);

    const handleEnded = (event: { event_id?: string; source_event_id?: string }) => {
      if (
        event.source_event_id === commandEventId ||
        event.event_id === commandEventId
      ) {
        window.clearTimeout(timeout);
        session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleEnded);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs < 1500) {
          console.warn(
            `[liveavatar] AVATAR_SPEAK_ENDED suspiciously short elapsedMs=${elapsedMs} commandEventId=${commandEventId} transcriptLen=${transcript.length}`,
          );
          resolve({
            outcome: "ended-too-fast",
            commandEventId,
            elapsedMs,
            message: `Avatar reported speech ended after only ${elapsedMs}ms — likely never produced audio.`,
          });
          return;
        }
        resolve({ outcome: "ended", commandEventId, elapsedMs });
      }
    };

    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleEnded);
  });
}

export { AgentEventsEnum, LiveAvatarSession, LiveSessionEvent, VoiceChatEvent };
