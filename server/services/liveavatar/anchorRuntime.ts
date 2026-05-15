import { anchorIds, type AnchorId, type AnchorProfile, type AnchorRuntimeStatus } from "../../../shared/models";
import type { AppConfig } from "../../config";

function clip(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function getConfiguredLiveAvatarApiKey(
  config: AppConfig["liveAvatar"],
  anchorId: AnchorId,
) {
  return clip(config.anchors[anchorId].apiKey) ?? clip(config.apiKey);
}

export function hasConfiguredLiveAvatarApiKey(config: AppConfig["liveAvatar"]) {
  return Boolean(
    clip(config.apiKey) ||
      anchorIds.some((anchorId) => clip(config.anchors[anchorId].apiKey)),
  );
}

export function configureAnchorProfiles(
  baseProfiles: AnchorProfile[],
  config: AppConfig["liveAvatar"],
): AnchorProfile[] {
  return baseProfiles.map((profile) => {
    const configured = config.anchors[profile.id];

    return {
      ...profile,
      runtime: {
        ...profile.runtime,
        avatarId: clip(configured.avatarId) ?? profile.runtime.avatarId,
        voiceId: clip(configured.voiceId) ?? profile.runtime.voiceId,
        contextId: clip(configured.contextId) ?? profile.runtime.contextId,
        contextName: clip(configured.contextName) ?? profile.runtime.contextName,
      },
    };
  });
}

export function buildAnchorRuntimeStatus(
  profile: AnchorProfile,
  config: AppConfig["liveAvatar"],
): AnchorRuntimeStatus {
  const errors: string[] = [];

  if (config.mode === "full-api" && !getConfiguredLiveAvatarApiKey(config, profile.id)) {
    errors.push(`LiveAvatar API key missing for ${profile.id}. Set LIVEAVATAR_${profile.id.toUpperCase()}_API_KEY or LIVEAVATAR_API_KEY.`);
  }

  if (config.sandbox) {
    if (!clip(config.sandboxAvatarId)) {
      errors.push("LIVEAVATAR_SANDBOX_AVATAR_ID is missing.");
    }
  } else if (!clip(profile.runtime.avatarId)) {
    errors.push(`Avatar id missing for ${profile.id}.`);
  }

  if (profile.runtime.contextMode === "dynamic") {
    if (!clip(profile.runtime.contextName)) {
      errors.push(`Dynamic context name missing for ${profile.id}.`);
    }
  } else if (!clip(profile.runtime.contextId) && !clip(profile.runtime.contextName)) {
    errors.push(`Context id or context name missing for ${profile.id}.`);
  }

  return {
    valid: errors.length === 0 || config.mode === "mock",
    sandbox: config.sandbox,
    contextMode: profile.runtime.contextMode,
    configuredAvatarId: clip(profile.runtime.avatarId),
    configuredVoiceId: clip(profile.runtime.voiceId),
    configuredContextId: clip(profile.runtime.contextId),
    configuredContextName: profile.runtime.contextName,
    voiceFallbackNames: profile.runtime.voiceFallbackNames,
    errors: config.mode === "mock" ? [] : errors,
  };
}

export function buildAnchorRuntimeStatusMap(
  profiles: AnchorProfile[],
  config: AppConfig["liveAvatar"],
): Record<AnchorId, AnchorRuntimeStatus> {
  return Object.fromEntries(
    profiles.map((profile) => [profile.id, buildAnchorRuntimeStatus(profile, config)]),
  ) as Record<AnchorId, AnchorRuntimeStatus>;
}
