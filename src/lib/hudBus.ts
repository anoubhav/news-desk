import { useEffect } from "react";
import type { AnchorId } from "@shared/models";

/**
 * Tiny pub/sub for Newsroom HUD commands. The producer (App.tsx) translates
 * existing app state — speak events, citations, sentiment flips — into
 * HudEvents and emits them here. HUD components subscribe via useHudEvent().
 *
 * Deliberately not a reactive store: HUD pieces are short-lived overlays
 * (slide in, hold, slide out) and respond to discrete events, not state.
 */

export type HudEvent =
  | {
      type: "l3.show";
      anchorId: AnchorId;
      name: string;
      role: string;
      accent: string;
      durationMs: number;
    }
  | { type: "l3.hide"; anchorId: AnchorId }
  | {
      type: "ots.show";
      anchorId: AnchorId;
      outlet: string;
      headline: string;
      label?: string;
      accent: string;
      side: "left" | "right";
      durationMs?: number;
    }
  | { type: "ots.hide"; anchorId: AnchorId }
  | {
      type: "breaking.show";
      kicker: string;
      text: string;
      accent?: string;
      durationMs?: number;
    }
  | { type: "breaking.hide" }
  | {
      type: "pullQuote.show";
      quote: string;
      attribution: string;
      accent: string;
      durationMs?: number;
    }
  | { type: "pullQuote.hide" }
  | {
      type: "ticker.update";
      /** Each entry becomes one crawl item, separated by a divider. */
      items: string[];
      /** Hex color for the left badge + dividers. */
      accent: string;
      /** Short left-badge label, e.g. "LIVE", "BREAKING". */
      label: string;
      /** Seconds for one full loop; lower = faster scroll. */
      speedSeconds?: number;
    };

export type HudEventType = HudEvent["type"];

type Listener<T extends HudEvent = HudEvent> = (event: T) => void;

const listeners = new Map<HudEventType, Set<Listener>>();

export function emitHudEvent(event: HudEvent): void {
  const set = listeners.get(event.type);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      console.error("[hudBus] listener threw", err);
    }
  }
}

export function subscribeHudEvent<T extends HudEventType>(
  type: T,
  listener: Listener<Extract<HudEvent, { type: T }>>,
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener as Listener);
  return () => {
    set!.delete(listener as Listener);
  };
}

/** Hook wrapper for HUD subscribers. The handler is intentionally not in deps. */
export function useHudEvent<T extends HudEventType>(
  type: T,
  handler: (event: Extract<HudEvent, { type: T }>) => void,
): void {
  useEffect(() => subscribeHudEvent(type, handler), [type]); // eslint-disable-line react-hooks/exhaustive-deps
}
