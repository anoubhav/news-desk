import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSourceService } from "./liveSource";

const originalFetch = global.fetch;

function buildValidPayload() {
  return {
    contractVersion: "live_source_v1",
    storyPacket: {
      story_id: "live-001",
      title: "Senate debate reaction shifts turnout story",
      sourceUpdatedAt: "2026-04-09T18:30:00Z",
      event_time_window: "Last 45 seconds",
      topic: "debate reaction",
      keywords_spiking: ["debate", "turnout", "suburbs"],
      neutral_summary: "Coverage moved from debate clips to turnout implications.",
      left_framing_summary: "Left-leaning channels stressed turnout and abortion messaging.",
      right_framing_summary: "Right-leaning channels stressed border framing and contrast lines.",
      consensus_points: ["The debate changed the race narrative."],
      divergence_points: ["The side clusters disagree on which issue won the night."],
      sentiment_by_cluster: {
        neutral: "measured",
        left: "energized",
        right: "aggressive",
      },
      ad_safety_state: "caution",
      confidence: 0.82,
      source_evidence: [
        {
          channel: "Wire Pool",
          lean: "neutral",
          timestamp: "2026-04-09T18:29:52Z",
          note: "Anchors shifted from clip replay to turnout analysis.",
        },
      ],
    },
  };
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("liveSource", () => {
  it("accepts the exact live_source_v1 payload shape", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: async () => buildValidPayload(),
    } as Response);

    const service = new LiveSourceService({
      apiUrl: "https://backend.example.com",
      currentPath: "/api/live/current",
      apiKey: "test-key",
      pollMs: 5000,
    });

    const payload = await service.getCurrent();

    expect(payload.status).toBe("fresh");
    expect(payload.stale).toBe(false);
    expect(payload.upstreamAvailable).toBe(true);
    expect(payload.storyPacket?.sourceType).toBe("live_feed");
    expect(payload.storyPacket?.story_id).toBe("live-001");
    expect(payload.storyPacket?.confidence).toBe(0.82);
  });

  it("marks wrapped payloads as invalid contract", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: async () => ({
        data: buildValidPayload(),
      }),
    } as Response);

    const service = new LiveSourceService({
      apiUrl: "https://backend.example.com",
      currentPath: "/api/live/current",
      apiKey: "test-key",
      pollMs: 5000,
    });

    const payload = await service.getCurrent();

    expect(payload.status).toBe("invalid_contract");
    expect(payload.errorCode).toBe("invalid_contract");
    expect(payload.storyPacket).toBeNull();
  });

  it("rejects confidence values outside 0..1", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: async () => ({
        ...buildValidPayload(),
        storyPacket: {
          ...buildValidPayload().storyPacket,
          confidence: 82,
        },
      }),
    } as Response);

    const service = new LiveSourceService({
      apiUrl: "https://backend.example.com",
      currentPath: "/api/live/current",
      apiKey: "test-key",
      pollMs: 5000,
    });

    const payload = await service.getCurrent();

    expect(payload.status).toBe("invalid_contract");
    expect(payload.errorMessage).toContain("confidence");
  });

  it("returns stale cached packets when the upstream later fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/json",
        }),
        json: async () => buildValidPayload(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({
          "content-type": "application/json",
        }),
      } as Response);

    const service = new LiveSourceService({
      apiUrl: "https://backend.example.com",
      currentPath: "/api/live/current",
      apiKey: undefined,
      pollMs: 5000,
    });

    const first = await service.getCurrent();
    const second = await service.getCurrent();

    expect(first.status).toBe("fresh");
    expect(second.status).toBe("stale");
    expect(second.errorCode).toBe("upstream_error");
    expect(second.storyPacket?.story_id).toBe("live-001");
    expect(second.lastSuccessfulFetchedAt).toBe(first.fetchedAt);
  });

  it("rejects non-json responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "text/plain",
      }),
    } as Response);

    const service = new LiveSourceService({
      apiUrl: "https://backend.example.com",
      currentPath: "/api/live/current",
      apiKey: undefined,
      pollMs: 5000,
    });

    const payload = await service.getCurrent();

    expect(payload.status).toBe("upstream_error");
    expect(payload.storyPacket).toBeNull();
    expect(payload.errorMessage).toContain("did not return JSON");
  });

  it("returns misconfigured when no live source is configured", async () => {
    const service = new LiveSourceService({
      apiUrl: undefined,
      currentPath: undefined,
      apiKey: undefined,
      pollMs: 5000,
    });

    const payload = await service.getCurrent();

    expect(payload.status).toBe("misconfigured");
    expect(payload.errorCode).toBe("misconfigured");
    expect(payload.storyPacket).toBeNull();
  });
});
