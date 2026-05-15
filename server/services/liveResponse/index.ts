import type { AppConfig } from "../../config";
import { GeminiProvider } from "./geminiProvider";
import { LiveResponseBuilder } from "./builder";
import { OpenAIProvider } from "./openaiProvider";
import type { LiveResponseProvider } from "./provider";

export function createLiveResponseProvider(config: AppConfig["llm"]): LiveResponseProvider | null {
  return config.provider === "gemini" ? new GeminiProvider(config) : new OpenAIProvider(config);
}

export function createLiveResponseBuilder(config: AppConfig["llm"]) {
  return new LiveResponseBuilder(createLiveResponseProvider(config));
}

export { LiveResponseBuilder } from "./builder";
export type { BuiltLiveTurn } from "./builder";
export type { LiveResponseProvider, LiveResponseRequest, LiveResponseResult } from "./provider";
