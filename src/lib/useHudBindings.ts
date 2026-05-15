import { useEffect, useRef } from "react";
import type {
  AnchorId,
  AnchorProfile,
  HudContext,
  HudContextResponse,
  PanelTurn,
  StoryPacket,
} from "@shared/models";
import { emitHudEvent } from "./hudBus";

const FALLBACK_ACCENTS: Record<AnchorId, string> = {
  neutral: "#E0B660",
  left: "#E07262",
  right: "#5A8FE6",
};

const ROUND_IDLE_DEBOUNCE_MS = 1500;
const TICKER_ACCENT = "#E0B660";

function resolveAccent(profile: AnchorProfile | undefined, anchorId: AnchorId): string {
  // AnchorProfile.accent is sometimes a `var(--neutral-accent)` CSS variable,
  // which we can't pass straight to inline styles. Use the literal hex from
  // styles.css when we see a var().
  const raw = profile?.accent;
  if (!raw || raw.startsWith("var(")) return FALLBACK_ACCENTS[anchorId];
  return raw;
}

function roleLabel(profile: AnchorProfile | undefined, anchorId: AnchorId): string {
  if (!profile) return "ELECTION DESK";
  switch (anchorId) {
    case "left":
      return "LEFT-SIDE ANALYST — ELECTION DESK";
    case "right":
      return "RIGHT-SIDE ANALYST — ELECTION DESK";
    default:
      return "MODERATOR — ELECTION DESK";
  }
}

function deterministicFallback(packet: StoryPacket): HudContext {
  const items: string[] = [];
  if (packet.topic) items.push(packet.topic.toUpperCase());
  for (const kw of packet.keywords_spiking ?? []) {
    if (kw && items.length < 6) items.push(kw.toUpperCase());
  }
  for (const ev of packet.source_evidence ?? []) {
    if (items.length >= 8) break;
    const label = ev.note?.trim() ? `${ev.channel.toUpperCase()}: ${ev.note}` : ev.channel.toUpperCase();
    items.push(label);
  }
  if (items.length === 0) items.push("ELECTION DESK LIVE");
  return {
    tickerItems: items.slice(0, 8),
    tickerLabel: "LIVE",
    breakingHeadline:
      packet.divergence_points?.[0]?.toUpperCase() ??
      `${packet.topic ?? "STORY"} — PANEL SPLIT`,
    breakingKicker: "BREAKING",
  };
}

function getOrigin(): string {
  if (typeof window === "undefined" || !window.location) return "";
  const origin = window.location.origin;
  if (!origin || origin === "null" || origin === "about:blank") return "";
  return origin;
}

type BindingsArgs = {
  activeSpeaker: AnchorId | null;
  anchors: AnchorProfile[];
  storyPacket: StoryPacket | null;
  /** Flat list of completed panel turns (in arrival order). */
  panelTurns: PanelTurn[];
};

/**
 * Translates existing App state (activeSpeaker, storyPacket, panelTurns) into
 * HUD events.
 *
 *  - L3 plate flashes whenever activeSpeaker becomes a real anchor.
 *  - Ticker headlines + BREAKING headline are sourced from
 *    [/api/hud/contextual](server/index.ts) (Gemini-backed) whenever the
 *    current story changes; we paint a deterministic fallback first so the
 *    HUD never sits empty while the LLM call is in flight.
 *  - After each round completes (detected as a 1.5s pause in speaking after at
 *    least one new turn since the last fetch), refetch with the just-completed
 *    round's transcript folded in. The ticker then reflects what the panel
 *    actually said this round.
 */
export function useHudBindings({
  activeSpeaker,
  anchors,
  storyPacket,
  panelTurns,
}: BindingsArgs): void {
  // L3 name plate: show on every speaker change. Auto-hides after 5s in the
  // L3Name component itself.
  const lastSpeakerRef = useRef<AnchorId | null>(null);
  useEffect(() => {
    if (lastSpeakerRef.current && lastSpeakerRef.current !== activeSpeaker) {
      emitHudEvent({ type: "l3.hide", anchorId: lastSpeakerRef.current });
    }
    lastSpeakerRef.current = activeSpeaker;
    if (!activeSpeaker) return;
    const profile = anchors.find((a) => a.id === activeSpeaker);
    emitHudEvent({
      type: "l3.show",
      anchorId: activeSpeaker,
      name: (profile?.label ?? activeSpeaker).toUpperCase(),
      role: roleLabel(profile, activeSpeaker),
      accent: resolveAccent(profile, activeSpeaker),
      durationMs: 5000,
    });
  }, [activeSpeaker, anchors]);

  // INITIAL fetch: ticker + BREAKING bar on story change. Paints a
  // deterministic fallback first so the lower-third never sits empty while
  // the network call is in flight.
  const lastStoryRef = useRef<string | null>(null);
  const lastFetchedTurnCountRef = useRef<number>(0);
  useEffect(() => {
    if (!storyPacket) return;
    if (lastStoryRef.current === storyPacket.id) return;
    lastStoryRef.current = storyPacket.id;
    lastFetchedTurnCountRef.current = 0;

    const fallback = deterministicFallback(storyPacket);
    emitHudEvent({
      type: "ticker.update",
      items: fallback.tickerItems,
      accent: TICKER_ACCENT,
      label: fallback.tickerLabel,
    });
    if ((storyPacket.divergence_points ?? []).length > 0) {
      emitHudEvent({
        type: "breaking.show",
        kicker: fallback.breakingKicker,
        text: fallback.breakingHeadline,
      });
    }

    const origin = getOrigin();
    if (!origin) return;
    const controller = new AbortController();
    fetch(`${origin}/api/hud/contextual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyPacket }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as HudContextResponse;
      })
      .then((payload) => {
        if (payload.storyId !== storyPacket.id) return;
        emitHudEvent({
          type: "ticker.update",
          items: payload.context.tickerItems,
          accent: TICKER_ACCENT,
          label: payload.context.tickerLabel,
        });
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        console.warn("[useHudBindings] initial hud fetch failed", err);
      });

    return () => controller.abort();
  }, [storyPacket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // AUTO PULL-QUOTE: when a new turn arrives whose fact-check flags a disputed
  // or unverified claim, fire a fullscreen `pullQuote.show` event. Throttled
  // to one fire per 30s so it lands as a punctuation moment, not a gimmick.
  // The PullQuoteCard auto-hides after 4.5s; we mirror that here.
  const lastPullQuoteTurnCountRef = useRef<number>(0);
  const lastPullQuoteAtRef = useRef<number>(0);
  useEffect(() => {
    if (panelTurns.length < lastPullQuoteTurnCountRef.current) {
      // Conversation was cleared/reset; rearm.
      lastPullQuoteTurnCountRef.current = 0;
      lastPullQuoteAtRef.current = 0;
    }
    const start = lastPullQuoteTurnCountRef.current;
    lastPullQuoteTurnCountRef.current = panelTurns.length;
    if (start >= panelTurns.length) return;

    const now = Date.now();
    if (now - lastPullQuoteAtRef.current < 30_000) return;

    for (let i = start; i < panelTurns.length; i++) {
      const turn = panelTurns[i];
      const fc = turn.factCheck;
      if (!fc || fc.mode === "unavailable") continue;
      const contested = fc.claims.find(
        (c) => c.verdict === "disputed" || c.verdict === "unverified",
      );
      if (!contested) continue;
      const quote = contested.text?.trim();
      if (!quote || quote.length < 8) continue;

      const profile = anchors.find((a) => a.id === turn.anchorId);
      const attribution = (profile?.label ?? turn.anchorLabel ?? turn.anchorId).toUpperCase();
      const accent = resolveAccent(profile, turn.anchorId);

      lastPullQuoteAtRef.current = now;
      emitHudEvent({
        type: "pullQuote.show",
        quote,
        attribution,
        accent,
        durationMs: 4500,
      });
      break;
    }
  }, [panelTurns, anchors]);

  // PER-ROUND refetch: when speaking goes idle (activeSpeaker → null) for
  // 1.5s and new turns have landed since the last fetch, call the endpoint
  // with the just-completed round's transcript. The ticker then reflects
  // what the anchors actually said this round.
  const idleTimerRef = useRef<number | null>(null);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (activeSpeaker) {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }
    if (!storyPacket) return;
    if (panelTurns.length <= lastFetchedTurnCountRef.current) return;

    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      const newTurns = panelTurns.slice(lastFetchedTurnCountRef.current);
      lastFetchedTurnCountRef.current = panelTurns.length;
      const lastRoundIndex = newTurns[newTurns.length - 1]?.roundIndex ?? 0;
      const roundTurns = newTurns
        .filter((t) => t.roundIndex === lastRoundIndex && t.transcript?.trim().length)
        .map((t) => ({
          anchorLabel: t.anchorLabel ?? t.anchorId,
          anchorLean: t.anchorId,
          transcript: t.transcript,
        }));
      if (roundTurns.length === 0) return;

      const origin = getOrigin();
      if (!origin) return;
      if (inFlightControllerRef.current) inFlightControllerRef.current.abort();
      const controller = new AbortController();
      inFlightControllerRef.current = controller;

      fetch(`${origin}/api/hud/contextual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyPacket,
          round: { roundIndex: lastRoundIndex, turns: roundTurns },
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as HudContextResponse;
        })
        .then((payload) => {
          if (payload.storyId !== storyPacket.id) return;
          emitHudEvent({
            type: "ticker.update",
            items: payload.context.tickerItems,
            accent: TICKER_ACCENT,
            label: payload.context.tickerLabel,
          });
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          console.warn("[useHudBindings] per-round hud fetch failed", err);
        });
    }, ROUND_IDLE_DEBOUNCE_MS);

    return () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [activeSpeaker, panelTurns, storyPacket]);
}
