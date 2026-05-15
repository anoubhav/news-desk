import { existsSync } from "node:fs";
import type { ReasoningEffort } from "../shared/models";

const reasoningEffortValues = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);

function parseReasoningEffort(value: string | undefined, fallback: ReasoningEffort): ReasoningEffort {
  if (value && reasoningEffortValues.has(value as ReasoningEffort)) {
    return value as ReasoningEffort;
  }
  return fallback;
}

function tryLoadEnvFile(path: string) {
  if (!existsSync(path)) {
    return;
  }
  try {
    process.loadEnvFile?.(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[config] skipping ${path}: ${message}`);
  }
}

tryLoadEnvFile(".env.local");
tryLoadEnvFile(".env");

export interface AppConfig {
  host: string;
  port: number;
  basicAuth: {
    user?: string;
    pass?: string;
  };
  llm: {
    provider: "openai" | "gemini";
    openaiApiKey?: string;
    openaiModel: string;
    openaiAdvancedModel: string;
    defaultReasoningEffort: ReasoningEffort;
    openaiBaseUrl: string;
    geminiApiKey?: string;
    geminiModel: string;
  };
  liveAvatar: {
    mode: "mock" | "full-api";
    apiKey?: string;
    apiUrl: string;
    sandbox: boolean;
    sandboxAvatarId: string;
    anchors: {
      neutral: {
        apiKey?: string;
        avatarId?: string;
        voiceId?: string;
        contextId?: string;
        contextName?: string;
      };
      left: {
        apiKey?: string;
        avatarId?: string;
        voiceId?: string;
        contextId?: string;
        contextName?: string;
      };
      right: {
        apiKey?: string;
        avatarId?: string;
        voiceId?: string;
        contextId?: string;
        contextName?: string;
      };
    };
  };
  liveSource: {
    apiUrl?: string;
    currentPath?: string;
    apiKey?: string;
    pollMs: number;
  };
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config: AppConfig = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4175),
  basicAuth: {
    user: process.env.BASIC_AUTH_USER,
    pass: process.env.BASIC_AUTH_PASS,
  },
  llm: {
    provider: process.env.LLM_PROVIDER === "gemini" ? "gemini" : "openai",
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    openaiAdvancedModel: process.env.OPENAI_ADVANCED_MODEL || "gpt-5.5",
    defaultReasoningEffort: parseReasoningEffort(process.env.OPENAI_REASONING_EFFORT, "medium"),
    openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
  liveAvatar: {
    mode: process.env.LIVEAVATAR_MODE === "full-api" ? "full-api" : "mock",
    apiKey: process.env.LIVEAVATAR_API_KEY,
    apiUrl: process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com",
    sandbox: parseBoolean(process.env.LIVEAVATAR_SANDBOX, true),
    sandboxAvatarId: process.env.LIVEAVATAR_SANDBOX_AVATAR_ID || "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a",
    anchors: {
      neutral: {
        apiKey: process.env.LIVEAVATAR_NEUTRAL_API_KEY,
        avatarId: process.env.LIVEAVATAR_NEUTRAL_AVATAR_ID,
        voiceId: process.env.LIVEAVATAR_NEUTRAL_VOICE_ID,
        contextId: process.env.LIVEAVATAR_NEUTRAL_CONTEXT_ID,
        contextName: process.env.LIVEAVATAR_NEUTRAL_CONTEXT_NAME,
      },
      left: {
        apiKey: process.env.LIVEAVATAR_LEFT_API_KEY,
        avatarId: process.env.LIVEAVATAR_LEFT_AVATAR_ID,
        voiceId: process.env.LIVEAVATAR_LEFT_VOICE_ID,
        contextId: process.env.LIVEAVATAR_LEFT_CONTEXT_ID,
        contextName: process.env.LIVEAVATAR_LEFT_CONTEXT_NAME,
      },
      right: {
        apiKey: process.env.LIVEAVATAR_RIGHT_API_KEY,
        avatarId: process.env.LIVEAVATAR_RIGHT_AVATAR_ID,
        voiceId: process.env.LIVEAVATAR_RIGHT_VOICE_ID,
        contextId: process.env.LIVEAVATAR_RIGHT_CONTEXT_ID,
        contextName: process.env.LIVEAVATAR_RIGHT_CONTEXT_NAME,
      },
    },
  },
  liveSource: {
    apiUrl: process.env.LIVE_SOURCE_API_URL,
    currentPath: process.env.LIVE_SOURCE_CURRENT_PATH,
    apiKey: process.env.LIVE_SOURCE_API_KEY,
    pollMs: parseNumber(process.env.LIVE_SOURCE_POLL_MS, 5000),
  },
};

function validateConfig() {
  const { basicAuth, liveAvatar, llm, liveSource } = config;

  if (!basicAuth.user || !basicAuth.pass) {
    console.warn(
      "[config] BASIC_AUTH_USER / BASIC_AUTH_PASS are not set; all routes are publicly accessible. Set both before exposing the server (e.g. via Cloudflare Tunnel).",
    );
  }

  if (liveAvatar.mode === "full-api") {
    const anchorKeys = [
      liveAvatar.anchors.neutral.apiKey,
      liveAvatar.anchors.left.apiKey,
      liveAvatar.anchors.right.apiKey,
    ];
    const hasGlobalKey = Boolean(liveAvatar.apiKey);
    const hasAnyPerAnchorKey = anchorKeys.some(Boolean);
    const hasAllPerAnchorKeys = anchorKeys.every(Boolean);

    if (!hasGlobalKey && !hasAnyPerAnchorKey) {
      console.warn(
        "[config] LIVEAVATAR_MODE=full-api but neither LIVEAVATAR_API_KEY nor any per-anchor LIVEAVATAR_*_API_KEY is set; anchors will fall back to mock.",
      );
    } else if (!hasGlobalKey && !hasAllPerAnchorKeys) {
      console.warn(
        "[config] LIVEAVATAR_MODE=full-api with partial per-anchor keys and no LIVEAVATAR_API_KEY fallback; anchors missing a key will fall back to mock.",
      );
    }
  }

  if (llm.provider === "openai" && !llm.openaiApiKey) {
    console.warn(
      "[config] LLM_PROVIDER=openai but OPENAI_API_KEY is missing; live-feed and article LLM turns will use the template fallback.",
    );
  }

  if (llm.provider === "gemini" && !llm.geminiApiKey) {
    console.warn(
      "[config] LLM_PROVIDER=gemini but neither GEMINI_API_KEY nor GOOGLE_API_KEY is set; live-feed and article LLM turns will use the template fallback.",
    );
  }

  const hasLiveUrl = Boolean(liveSource.apiUrl);
  const hasLivePath = Boolean(liveSource.currentPath);
  if (hasLiveUrl !== hasLivePath) {
    console.warn(
      "[config] LIVE_SOURCE_API_URL and LIVE_SOURCE_CURRENT_PATH must both be set for the live feed to work; one is missing, so the live feed will report misconfigured.",
    );
  }
}

validateConfig();
