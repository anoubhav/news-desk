import { useState } from "react";
import { HfPlayer } from "../../lib/hyperframesPlayer";
import { useHudEvent } from "../../lib/hudBus";

type TickerVars = {
  items: string[];
  accent: string;
  label: string;
  speedSeconds?: number;
};

/**
 * Bottom-of-stage news ticker. The Hyperframes Player loads
 * /hyperframes/players/live-ticker.html — which, in this server, is served by
 * a small middleware that bakes the caller's items/accent/label into
 * `data-variable-values` on the ticker host. The ticker composition's
 * defensive resolver reads that attribute and rebuilds its crawl.
 *
 * Re-renders when a `ticker.update` event flows through hudBus (fired from
 * useHudBindings whenever the current story changes). We key the player on
 * the encoded src so React unmounts/remounts on every change — the simplest
 * way to force a fresh iframe load with the new content.
 *
 * Until the first update arrives we fall back to the composition's built-in
 * defaults (no query string → middleware passes the file through untouched).
 */
export function Ticker() {
  const [vars, setVars] = useState<TickerVars | null>(null);

  useHudEvent("ticker.update", (event) => {
    setVars({
      items: event.items,
      accent: event.accent,
      label: event.label,
      speedSeconds: event.speedSeconds,
    });
  });

  const src = buildTickerSrc(vars);

  return (
    <div className="hud-ticker" aria-hidden="true">
      <HfPlayer
        key={src}
        src={src}
        width={1920}
        height={1080}
        muted
        loop
      />
    </div>
  );
}

function buildTickerSrc(vars: TickerVars | null): string {
  const base = "/hyperframes/players/live-ticker.html";
  if (!vars) return base;
  const cleanItems = vars.items.map((s) => s.replace(/\|/g, "/").trim()).filter(Boolean);
  if (cleanItems.length === 0) return base;
  const qs = new URLSearchParams();
  qs.set("items", cleanItems.join(" | "));
  if (vars.accent) qs.set("accent", vars.accent);
  if (vars.label) qs.set("label", vars.label);
  if (typeof vars.speedSeconds === "number" && vars.speedSeconds > 0) {
    qs.set("speed", String(vars.speedSeconds));
  }
  return `${base}?${qs.toString()}`;
}
