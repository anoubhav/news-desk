import { afterEach, describe, expect, it, vi } from "vitest";
import { baseAnchorProfiles } from "../../data/anchors";
import { FullApiLiveAvatarProvider } from "./fullApiLiveAvatarProvider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FullApiLiveAvatarProvider", () => {
  it("uses per-anchor API keys and isolates runtime caches by effective key", async () => {
    const fetchCalls: Array<{ url: string; apiKey: string }> = [];

    global.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const apiKey = String(new Headers(init?.headers).get("X-API-KEY") ?? "");
      fetchCalls.push({ url, apiKey });

      if (url.endsWith("/v1/contexts")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              results:
                apiKey === "neutral-key"
                  ? [{ id: "neutral-context-id", name: "Election Desk • Avery Quinn v2" }]
                  : [{ id: "left-context-id", name: "Election Desk • Maya Reyes v2" }],
            },
          }),
        } as Response;
      }

      if (url.endsWith("/v1/voices")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              results:
                apiKey === "neutral-key"
                  ? [{ id: "neutral-voice-id", name: "Judy - Professional", language: "en" }]
                  : [{ id: "left-voice-id", name: "Ann - IA", language: "en" }],
            },
          }),
        } as Response;
      }

      if (url.endsWith("/v1/sessions/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              session_id: `${apiKey}-session`,
              session_token: `${apiKey}-token`,
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch call for ${url}`);
    }) as typeof fetch;

    const provider = new FullApiLiveAvatarProvider({
      mode: "full-api",
      apiKey: undefined,
      apiUrl: "https://api.liveavatar.com",
      sandbox: true,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {
          apiKey: "neutral-key",
        },
        left: {
          apiKey: "left-key",
        },
        right: {},
      },
    });

    const neutralSession = await provider.createSession(baseAnchorProfiles[0]);
    const leftSession = await provider.createSession(baseAnchorProfiles[1]);
    await provider.createSession(baseAnchorProfiles[0]);

    expect(neutralSession.sessionAccessToken).toBe("neutral-key-token");
    expect(leftSession.sessionAccessToken).toBe("left-key-token");
    expect(fetchCalls.filter((call) => call.apiKey === "neutral-key" && call.url.endsWith("/v1/contexts"))).toHaveLength(1);
    // /v1/voices is never fetched — each avatar carries its own bundled voice
    // and we no longer override that with a name-based fallback.
    expect(fetchCalls.filter((call) => call.apiKey === "neutral-key" && call.url.endsWith("/v1/voices"))).toHaveLength(0);
    expect(fetchCalls.filter((call) => call.apiKey === "neutral-key" && call.url.endsWith("/v1/sessions/token"))).toHaveLength(2);
    expect(fetchCalls.filter((call) => call.apiKey === "left-key" && call.url.endsWith("/v1/contexts"))).toHaveLength(1);
    expect(fetchCalls.filter((call) => call.apiKey === "left-key" && call.url.endsWith("/v1/voices"))).toHaveLength(0);
    expect(fetchCalls.filter((call) => call.apiKey === "left-key" && call.url.endsWith("/v1/sessions/token"))).toHaveLength(1);
  });

  it("retries session creation when the provider is still releasing the previous concurrency slot", async () => {
    vi.useFakeTimers();

    let sessionTokenAttempts = 0;

    global.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const apiKey = String(new Headers(init?.headers).get("X-API-KEY") ?? "");

      if (url.endsWith("/v1/contexts")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              results: [{ id: "neutral-context-id", name: "Election Desk • Neutral Desk" }],
            },
          }),
        } as Response;
      }

      if (url.endsWith("/v1/voices")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              results: [{ id: "neutral-voice-id", name: "Judy - Professional", language: "en" }],
            },
          }),
        } as Response;
      }

      if (url.endsWith("/v1/sessions/token")) {
        sessionTokenAttempts += 1;
        if (sessionTokenAttempts < 3) {
          return {
            ok: false,
            status: 409,
            text: async () => "Session concurrency limit reached",
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              session_id: `${apiKey}-session`,
              session_token: `${apiKey}-token`,
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch call for ${url}`);
    }) as typeof fetch;

    const provider = new FullApiLiveAvatarProvider({
      mode: "full-api",
      apiKey: "shared-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: true,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {},
        left: {},
        right: {},
      },
    });

    const sessionPromise = provider.createSession(baseAnchorProfiles[0]);
    await vi.runAllTimersAsync();
    const session = await sessionPromise;

    expect(session.sessionId).toBe("shared-key-session");
    expect(session.sessionAccessToken).toBe("shared-key-token");
    expect(sessionTokenAttempts).toBe(3);
  });
});
