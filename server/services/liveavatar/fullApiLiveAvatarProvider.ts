import type { AnchorProfile, AnchorSession, SessionEvent } from "../../../shared/models";
import type { FullModeProvider, SessionSeed } from "./provider";
import type { AppConfig } from "../../config";
import { getConfiguredLiveAvatarApiKey, hasConfiguredLiveAvatarApiKey } from "./anchorRuntime";

interface ContextRecord {
  id: string;
  name: string;
}

interface VoiceRecord {
  id: string;
  name: string;
  language?: string;
}

interface RuntimeAnchorConfig {
  avatarId: string;
  voiceId?: string;
  contextId: string;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clipValue(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function isSessionConcurrencyError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("concurrency") ||
    message.includes("concurrent") ||
    message.includes("limit reached") ||
    message.includes("too many active") ||
    message.includes(": 409 ") ||
    message.includes(": 429 ")
  );
}

export class FullApiLiveAvatarProvider implements FullModeProvider {
  readonly mode = "full-api" as const;

  private readonly runtimeConfig = new Map<string, RuntimeAnchorConfig>();
  private readonly voiceCache = new Map<string, VoiceRecord[]>();
  private readonly contextCache = new Map<string, ContextRecord[]>();

  constructor(private readonly appConfig: AppConfig["liveAvatar"]) {
    if (!hasConfiguredLiveAvatarApiKey(this.appConfig)) {
      throw new Error("A LiveAvatar API key is required for full-api mode");
    }
  }

  async createSession(profile: AnchorProfile): Promise<SessionSeed> {
    const apiKey = this.resolveApiKey(profile.id);
    const runtime = await this.resolveRuntimeConfig(profile, apiKey);
    // is_sandbox=true is only accepted by the LiveAvatar API when the avatar is
    // sandbox-approved (typically just the configured sandboxAvatarId). If the
    // user picked a real-mode avatar from the gallery, send is_sandbox=false so
    // the request isn't rejected with "avatar not supported in sandbox mode".
    const useSandbox = this.appConfig.sandbox && runtime.avatarId === this.appConfig.sandboxAvatarId;
    const payload: Record<string, unknown> = {
      mode: "FULL",
      is_sandbox: useSandbox,
      avatar_id: runtime.avatarId,
      avatar_persona: {
        context_id: runtime.contextId,
        language: "en",
        ...(runtime.voiceId ? { voice_id: runtime.voiceId } : {}),
      },
    };

    let response:
      | {
          data: { session_id: string; session_token: string };
        }
      | undefined;
    const retryDelaysMs = [1200, 2500, 4000];

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        response = await this.requestJson<{
          data: { session_id: string; session_token: string };
        }>(
          "/v1/sessions/token",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          apiKey,
        );
        break;
      } catch (error) {
        if (!isSessionConcurrencyError(error) || attempt === retryDelaysMs.length) {
          throw error;
        }

        await delay(retryDelaysMs[attempt]);
      }
    }

    if (!response) {
      throw new Error(`LiveAvatar did not return a session token for ${profile.id}.`);
    }

    return {
      anchorId: profile.id,
      sessionId: response.data.session_id,
      providerMode: this.mode,
      sandbox: useSandbox,
      sessionAccessToken: response.data.session_token,
      resolvedAvatarId: runtime.avatarId,
      resolvedVoiceId: runtime.voiceId,
      resolvedContextId: runtime.contextId,
    };
  }

  async speakText(session: AnchorSession, text: string): Promise<SessionEvent[]> {
    void session;
    void text;
    return [];
  }

  async stopSession(session: AnchorSession): Promise<void> {
    if (!session.sessionAccessToken) {
      return;
    }

    await fetch(`${this.appConfig.apiUrl}/v1/sessions/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.sessionAccessToken}`,
      },
    }).catch(() => undefined);
  }

  private async resolveRuntimeConfig(profile: AnchorProfile, apiKey: string): Promise<RuntimeAnchorConfig> {
    const cacheKey = `${apiKey}:${profile.id}:${profile.runtime.contextName}:${profile.runtime.contextId ?? ""}:${profile.runtime.avatarId ?? ""}:${profile.runtime.voiceId ?? ""}`;
    const cached = this.runtimeConfig.get(cacheKey);
    if (cached) {
      return cached;
    }

    const contextId = await this.resolveContextId(profile, apiKey);
    const voiceId = await this.resolveVoiceId(profile, apiKey);
    const avatarId = this.resolveAvatarId(profile);

    const runtime: RuntimeAnchorConfig = {
      avatarId,
      voiceId,
      contextId,
    };

    this.runtimeConfig.set(cacheKey, runtime);
    return runtime;
  }

  private resolveAvatarId(profile: AnchorProfile) {
    // A user-picked avatar (via the gallery, stored on profile.runtime.avatarId)
    // always wins — otherwise sandbox mode would force every anchor to the same
    // shared sandbox avatar even after the user picked distinct ones.
    const profileAvatarId = clipValue(profile.runtime.avatarId);
    if (profileAvatarId) {
      return profileAvatarId;
    }

    if (this.appConfig.sandbox) {
      return this.appConfig.sandboxAvatarId;
    }

    throw new Error(`Missing avatar id for ${profile.id}; provide LIVEAVATAR_${profile.id.toUpperCase()}_AVATAR_ID`);
  }

  private async resolveVoiceId(profile: AnchorProfile, _apiKey: string) {
    // Each avatar is configured on the LiveAvatar platform with its own
    // bundled voice (Avery and Maya feminine, Cole masculine). Trust the
    // avatar id and don't override the voice unless the operator has set
    // LIVEAVATAR_<ANCHOR>_VOICE_ID. We deliberately do NOT match by name
    // against /v1/voices or fall back to any English voice — both of those
    // can return a wrong-gender voice and the result depends on platform
    // listing order.
    if (clipValue(profile.runtime.voiceId)) {
      return profile.runtime.voiceId;
    }
    return undefined;
  }

  private async resolveContextId(profile: AnchorProfile, apiKey: string) {
    if (profile.runtime.contextMode === "fixed" && clipValue(profile.runtime.contextId)) {
      return profile.runtime.contextId!;
    }

    const contextName = profile.runtime.contextName;
    const contexts = await this.listContexts(apiKey);
    const existing = contexts.find((context) => context.name === contextName);
    if (existing) {
      return existing.id;
    }

    const created = await this.requestJson<{
      data: { id: string; name: string };
    }>("/v1/contexts", {
      method: "POST",
      body: JSON.stringify({
        name: contextName,
        prompt: profile.instructions,
        opening_text: profile.openingText,
      }),
    }, apiKey);

    const cachedContexts = this.contextCache.get(apiKey) ?? [];
    cachedContexts.push({ id: created.data.id, name: created.data.name });
    this.contextCache.set(apiKey, cachedContexts);
    return created.data.id;
  }

  private async listVoices(apiKey: string) {
    const cached = this.voiceCache.get(apiKey);
    if (cached) {
      return cached;
    }

    const response = await this.requestJson<{
      data: { results: Array<{ id: string; name: string; language?: string }> };
    }>("/v1/voices", undefined, apiKey);

    this.voiceCache.set(apiKey, response.data.results);
    return response.data.results;
  }

  private async listContexts(apiKey: string) {
    const cached = this.contextCache.get(apiKey);
    if (cached) {
      return cached;
    }

    const response = await this.requestJson<{
      data: { results: Array<{ id: string; name: string }> };
    }>("/v1/contexts", undefined, apiKey);

    this.contextCache.set(apiKey, response.data.results);
    return response.data.results;
  }

  private resolveApiKey(anchorId: AnchorProfile["id"]) {
    const apiKey = getConfiguredLiveAvatarApiKey(this.appConfig, anchorId);
    if (!apiKey) {
      throw new Error(
        `LiveAvatar API key missing for ${anchorId}; provide LIVEAVATAR_${anchorId.toUpperCase()}_API_KEY or LIVEAVATAR_API_KEY`,
      );
    }

    return apiKey;
  }

  private async requestJson<T>(path: string, init?: RequestInit, apiKey?: string): Promise<T> {
    const response = await fetch(`${this.appConfig.apiUrl}${path}`, {
      ...init,
      headers: {
        "X-API-KEY": apiKey ?? this.appConfig.apiKey!,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LiveAvatar request failed for ${path}: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }
}
