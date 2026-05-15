import { z } from "zod";
import { anchorIds, type LivePacketResponse, type StoryPacket } from "../../shared/models";
import type { AppConfig } from "../config";

function timestamp() {
  return new Date().toISOString();
}

const sourceEvidenceSchema = z
  .object({
    channel: z.string().trim().min(1),
    lean: z.enum(anchorIds),
    timestamp: z.string().trim().min(1),
    note: z.string().trim().min(1),
  })
  .strict();

const upstreamStoryPacketSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    story_id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    sourceUpdatedAt: z.string().trim().min(1),
    event_time_window: z.string().trim().min(1),
    topic: z.string().trim().min(1),
    keywords_spiking: z.array(z.string().trim().min(1)),
    neutral_summary: z.string().trim().min(1),
    left_framing_summary: z.string().trim().min(1),
    right_framing_summary: z.string().trim().min(1),
    consensus_points: z.array(z.string().trim().min(1)).min(1),
    divergence_points: z.array(z.string().trim().min(1)).min(1),
    sentiment_by_cluster: z
      .object({
        neutral: z.string().trim().min(1),
        left: z.string().trim().min(1),
        right: z.string().trim().min(1),
      })
      .strict(),
    ad_safety_state: z.enum(["safe", "caution", "unsafe"]),
    confidence: z.number().min(0).max(1),
    source_evidence: z.array(sourceEvidenceSchema),
  })
  .strict();

const liveSourceContractSchema = z
  .object({
    contractVersion: z.literal("live_source_v1"),
    storyPacket: upstreamStoryPacketSchema,
  })
  .strict();

function toLiveStoryPacket(packet: z.infer<typeof upstreamStoryPacketSchema>): StoryPacket {
  return {
    id: packet.id ?? packet.story_id,
    story_id: packet.story_id,
    title: packet.title,
    sourceType: "live_feed",
    sourceUpdatedAt: packet.sourceUpdatedAt,
    event_time_window: packet.event_time_window,
    topic: packet.topic,
    keywords_spiking: packet.keywords_spiking,
    neutral_summary: packet.neutral_summary,
    left_framing_summary: packet.left_framing_summary,
    right_framing_summary: packet.right_framing_summary,
    consensus_points: packet.consensus_points,
    divergence_points: packet.divergence_points,
    sentiment_by_cluster: packet.sentiment_by_cluster,
    ad_safety_state: packet.ad_safety_state,
    confidence: packet.confidence,
    source_evidence: packet.source_evidence,
  };
}

function flattenSchemaError(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
    .join("; ");
}

export class LiveSourceService {
  private lastSuccessfulPacket: StoryPacket | null = null;
  private lastSuccessfulFetchedAt?: string;

  constructor(private readonly config: AppConfig["liveSource"]) {}

  isEnabled() {
    return Boolean(this.config.apiUrl && this.config.currentPath);
  }

  getPollMs() {
    return this.config.pollMs;
  }

  getCachedPacket() {
    return this.lastSuccessfulPacket;
  }

  async getCurrent(): Promise<LivePacketResponse> {
    const fetchedAt = timestamp();

    if (!this.isEnabled()) {
      return {
        storyPacket: this.lastSuccessfulPacket,
        fetchedAt,
        status: this.lastSuccessfulPacket ? "stale" : "misconfigured",
        stale: this.lastSuccessfulPacket != null,
        upstreamAvailable: false,
        errorCode: "misconfigured",
        errorMessage: "Live source is not configured.",
        lastSuccessfulFetchedAt: this.lastSuccessfulFetchedAt,
      };
    }

    try {
      const payload = await this.requestJson(this.resolveCurrentUrl());
      const parsed = liveSourceContractSchema.safeParse(payload);
      if (!parsed.success) {
        return this.buildFailureResponse(
          "invalid_contract",
          fetchedAt,
          `Live source contract validation failed: ${flattenSchemaError(parsed.error)}`,
          true,
        );
      }

      const storyPacket = toLiveStoryPacket(parsed.data.storyPacket);
      this.lastSuccessfulPacket = storyPacket;
      this.lastSuccessfulFetchedAt = fetchedAt;

      return {
        storyPacket,
        fetchedAt,
        status: "fresh",
        stale: false,
        upstreamAvailable: true,
        lastSuccessfulFetchedAt: this.lastSuccessfulFetchedAt,
      };
    } catch (error) {
      return this.buildFailureResponse(
        "upstream_error",
        fetchedAt,
        error instanceof Error ? error.message : "Live source request failed.",
        false,
      );
    }
  }

  private buildFailureResponse(
    errorCode: "upstream_error" | "invalid_contract" | "misconfigured",
    fetchedAt: string,
    errorMessage: string,
    upstreamAvailable: boolean,
  ): LivePacketResponse {
    if (this.lastSuccessfulPacket) {
      return {
        storyPacket: this.lastSuccessfulPacket,
        fetchedAt,
        status: "stale",
        stale: true,
        upstreamAvailable,
        errorCode,
        errorMessage,
        lastSuccessfulFetchedAt: this.lastSuccessfulFetchedAt,
      };
    }

    return {
      storyPacket: null,
      fetchedAt,
      status: errorCode,
      stale: false,
      upstreamAvailable,
      errorCode,
      errorMessage,
      lastSuccessfulFetchedAt: this.lastSuccessfulFetchedAt,
    };
  }

  private resolveCurrentUrl() {
    return new URL(this.config.currentPath!, this.config.apiUrl).toString();
  }

  private async requestJson(url: string): Promise<unknown> {
    const headers = new Headers({
      Accept: "application/json",
    });

    if (this.config.apiKey) {
      headers.set("Authorization", `Bearer ${this.config.apiKey}`);
      headers.set("X-API-KEY", this.config.apiKey);
    }

    const timeoutMs = 5000;
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        console.warn(`[liveSource] fetch timed out after ${timeoutMs}ms for ${url}`);
        throw new Error(`Live source request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    });

    if (!response.ok) {
      throw new Error(`Live source request failed with ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error("Live source did not return JSON.");
    }

    return response.json();
  }
}
