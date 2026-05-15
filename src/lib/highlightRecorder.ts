import type { LiveAvatarSession } from "@heygen/liveavatar-web-sdk";

interface SessionInternals {
  _remoteAudioTrack?: { mediaStreamTrack?: MediaStreamTrack };
  _remoteVideoTrack?: { mediaStreamTrack?: MediaStreamTrack };
}

export interface HighlightRecorder {
  startTurn(turnId: string): boolean;
  stopTurn(): Promise<{ turnId: string; bytes: number } | null>;
  dispose(): void;
  isRecording(): boolean;
}

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Bind a per-turn MediaRecorder to a LiveAvatar session's outbound audio+video
 * tracks. The caller invokes `startTurn(turnId)` on `avatar.speak_started` and
 * `stopTurn()` on `avatar.speak_ended`; the resulting webm is POSTed to
 * `/api/highlights/clip/:sessionId/:turnId` as raw bytes.
 *
 * Silent when the session hasn't yet produced tracks (returns false from
 * startTurn). Safe to call dispose() multiple times.
 */
export function attachHighlightRecorder(
  session: LiveAvatarSession,
  highlightSessionId: string,
): HighlightRecorder {
  const internals = session as unknown as SessionInternals;
  let mediaStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let currentTurnId: string | null = null;
  let disposed = false;

  function ensureStream(): MediaStream | null {
    if (mediaStream) return mediaStream;
    const video = internals._remoteVideoTrack?.mediaStreamTrack;
    const audio = internals._remoteAudioTrack?.mediaStreamTrack;
    if (!video || !audio) return null;
    mediaStream = new MediaStream([video, audio]);
    return mediaStream;
  }

  return {
    startTurn(turnId) {
      if (disposed) return false;
      if (recorder && recorder.state === "recording") {
        try { recorder.stop(); } catch { /* ignore */ }
      }
      chunks = [];
      const stream = ensureStream();
      if (!stream) return false;
      const mimeType = pickMimeType();
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (err) {
        console.warn("[highlightRecorder] MediaRecorder ctor failed", err);
        return false;
      }
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      currentTurnId = turnId;
      try {
        recorder.start(500);
        return true;
      } catch (err) {
        console.warn("[highlightRecorder] start failed", err);
        return false;
      }
    },

    stopTurn() {
      if (!recorder || !currentTurnId) return Promise.resolve(null);
      const tid = currentTurnId;
      const r = recorder;
      currentTurnId = null;
      recorder = null;
      return new Promise((resolve) => {
        r.onstop = async () => {
          const mimeType = r.mimeType || "video/webm";
          const blob = new Blob(chunks, { type: mimeType });
          chunks = [];
          if (blob.size === 0) {
            resolve(null);
            return;
          }
          const url = `/api/highlights/clip/${encodeURIComponent(highlightSessionId)}/${encodeURIComponent(tid)}`;
          try {
            await fetch(url, {
              method: "POST",
              body: blob,
              headers: { "Content-Type": mimeType },
            });
            resolve({ turnId: tid, bytes: blob.size });
          } catch (err) {
            console.warn("[highlightRecorder] upload failed", err);
            resolve(null);
          }
        };
        try {
          r.stop();
        } catch (err) {
          console.warn("[highlightRecorder] stop failed", err);
          resolve(null);
        }
      });
    },

    dispose() {
      disposed = true;
      if (recorder && recorder.state === "recording") {
        try { recorder.stop(); } catch { /* ignore */ }
      }
      recorder = null;
      mediaStream = null;
      chunks = [];
      currentTurnId = null;
    },

    isRecording() {
      return recorder?.state === "recording";
    },
  };
}
