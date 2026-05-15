import type { AppConfig } from "../../config";
import { hasConfiguredLiveAvatarApiKey } from "./anchorRuntime";
import { FullApiLiveAvatarProvider } from "./fullApiLiveAvatarProvider";
import { MockLiveAvatarProvider } from "./mockLiveAvatarProvider";
import type { FullModeProvider } from "./provider";

export function createProvider(config: AppConfig["liveAvatar"]): FullModeProvider {
  if (config.mode === "full-api" && hasConfiguredLiveAvatarApiKey(config)) {
    return new FullApiLiveAvatarProvider(config);
  }

  return new MockLiveAvatarProvider();
}
