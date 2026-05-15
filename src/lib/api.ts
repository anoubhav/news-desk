import type {
  AnchorRuntimeConfigRequest,
  AnchorRuntimeConfigResponse,
  ArticleAskRequest,
  ArticleLoadRequest,
  ArticleLoadResponse,
  AvatarPreviewStopRequest,
  AvatarPreviewStopResponse,
  AvatarPreviewTokenRequest,
  AvatarPreviewTokenResponse,
  BootstrapResponse,
  FactCheckRequest,
  FactCheckResult,
  LivePacketResponse,
  OrchestrateRequest,
  OrchestrateStreamFrame,
  PublicAvatarsResponse,
  RelaySessionEventRequest,
  RelaySessionEventResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  SelectModeRequest,
  SelectModeResponse,
  SelectStoryRequest,
  SelectStoryResponse,
  VoiceTurnRequest,
  SyncSessionsRequest,
  SyncSessionsResponse,
} from "@shared/models";

async function* streamNdjson(path: string, body: unknown): AsyncGenerator<OrchestrateStreamFrame> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Request failed for ${path}: ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Keep the default message when the error body is not JSON.
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error(`Empty response body from ${path}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) {
            yield JSON.parse(line) as OrchestrateStreamFrame;
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }
      if (done) {
        const tail = buffer.trim();
        if (tail.length > 0) {
          yield JSON.parse(tail) as OrchestrateStreamFrame;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    let message = `Request failed for ${path}: ${response.status}`;

    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Keep the default message when the error body is not JSON.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  bootstrap() {
    return readJson<BootstrapResponse>("/api/bootstrap");
  },
  selectMode(payload: SelectModeRequest) {
    return readJson<SelectModeResponse>("/api/mode/select", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  liveCurrent() {
    return readJson<LivePacketResponse>("/api/live/current");
  },
  syncSessions(payload: SyncSessionsRequest) {
    return readJson<SyncSessionsResponse>("/api/sessions/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  refreshSession(payload: RefreshSessionRequest) {
    return readJson<RefreshSessionResponse>("/api/sessions/refresh", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  relaySessionEvent(payload: RelaySessionEventRequest) {
    return readJson<RelaySessionEventResponse>("/api/sessions/events", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  loadArticle(payload: ArticleLoadRequest) {
    return readJson<ArticleLoadResponse>("/api/articles/load", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  askArticleStream(payload: ArticleAskRequest): AsyncIterable<OrchestrateStreamFrame> {
    return streamNdjson("/api/articles/ask", payload);
  },
  selectStory(payload: SelectStoryRequest) {
    return readJson<SelectStoryResponse>("/api/stories/select", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  orchestrateStream(payload: OrchestrateRequest): AsyncIterable<OrchestrateStreamFrame> {
    return streamNdjson("/api/orchestrate", payload);
  },
  voiceTurnStream(payload: VoiceTurnRequest): AsyncIterable<OrchestrateStreamFrame> {
    return streamNdjson("/api/voice/turn", payload);
  },
  listPublicAvatars(params: { page?: number; pageSize?: number } = {}) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 24;
    return readJson<PublicAvatarsResponse>(`/api/avatars/public?page=${page}&page_size=${pageSize}`);
  },
  factCheck(payload: FactCheckRequest) {
    return readJson<FactCheckResult>("/api/factcheck", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  setAnchorRuntimeConfig(payload: AnchorRuntimeConfigRequest) {
    return readJson<AnchorRuntimeConfigResponse>("/api/anchors/runtime-config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  previewAvatarToken(payload: AvatarPreviewTokenRequest) {
    return readJson<AvatarPreviewTokenResponse>("/api/avatars/preview-token", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  stopPreviewSession(payload: AvatarPreviewStopRequest) {
    return readJson<AvatarPreviewStopResponse>("/api/avatars/preview-stop", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
