import { describe, expect, it } from "vitest";
import { baseAnchorProfiles } from "../../data/anchors";
import {
  buildAnchorRuntimeStatusMap,
  configureAnchorProfiles,
  getConfiguredLiveAvatarApiKey,
  hasConfiguredLiveAvatarApiKey,
} from "./anchorRuntime";

describe("anchorRuntime", () => {
  it("merges env-backed runtime overrides into base profiles", () => {
    const profiles = configureAnchorProfiles(baseAnchorProfiles, {
      mode: "full-api",
      apiKey: "liveavatar-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: false,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {
          avatarId: "avatar-neutral",
          voiceId: "voice-neutral",
          contextId: "context-neutral",
          contextName: "Neutral Custom Context",
        },
        left: {},
        right: {},
      },
    });

    expect(profiles[0].runtime.avatarId).toBe("avatar-neutral");
    expect(profiles[0].runtime.voiceId).toBe("voice-neutral");
    expect(profiles[0].runtime.contextId).toBe("context-neutral");
    expect(profiles[0].runtime.contextName).toBe("Neutral Custom Context");
  });

  it("flags invalid production config when avatar ids are missing", () => {
    const profiles = configureAnchorProfiles(baseAnchorProfiles, {
      mode: "full-api",
      apiKey: "liveavatar-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: false,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {},
        left: {},
        right: {},
      },
    });

    const status = buildAnchorRuntimeStatusMap(profiles, {
      mode: "full-api",
      apiKey: "liveavatar-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: false,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {},
        left: {},
        right: {},
      },
    });

    expect(status.neutral.valid).toBe(false);
    expect(status.neutral.errors[0]).toContain("Avatar id missing");
  });

  it("permits sandbox mode without per-anchor avatar ids", () => {
    const profiles = configureAnchorProfiles(baseAnchorProfiles, {
      mode: "full-api",
      apiKey: "liveavatar-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: true,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {},
        left: {},
        right: {},
      },
    });

    const status = buildAnchorRuntimeStatusMap(profiles, {
      mode: "full-api",
      apiKey: "liveavatar-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: true,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {},
        left: {},
        right: {},
      },
    });

    expect(status.neutral.valid).toBe(true);
    expect(status.left.valid).toBe(true);
    expect(status.right.valid).toBe(true);
  });

  it("resolves per-anchor API keys before falling back to the global key", () => {
    const config = {
      mode: "full-api" as const,
      apiKey: "global-key",
      apiUrl: "https://api.liveavatar.com",
      sandbox: true,
      sandboxAvatarId: "sandbox-avatar",
      anchors: {
        neutral: {
          apiKey: "neutral-key",
        },
        left: {},
        right: {
          apiKey: "right-key",
        },
      },
    };

    expect(hasConfiguredLiveAvatarApiKey(config)).toBe(true);
    expect(getConfiguredLiveAvatarApiKey(config, "neutral")).toBe("neutral-key");
    expect(getConfiguredLiveAvatarApiKey(config, "left")).toBe("global-key");
    expect(getConfiguredLiveAvatarApiKey(config, "right")).toBe("right-key");
  });
});
