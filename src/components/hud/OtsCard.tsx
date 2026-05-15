import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AnchorId } from "@shared/models";
import { useHudEvent } from "../../lib/hudBus";

type Props = { anchorId: AnchorId };

type State = {
  outlet: string;
  headline: string;
  label: string;
  accent: string;
  side: "left" | "right";
  id: number;
  duration: number;
};

/**
 * Over-the-shoulder source card scoped to a single anchor. Mirrors
 * hyperframes/compositions/components/ots-card.html. Mounted inside the
 * per-anchor [src/components/AnchorCard.tsx] so it pins to that anchor.
 */
export function OtsCard({ anchorId }: Props) {
  const [state, setState] = useState<State | null>(null);

  useHudEvent("ots.show", (event) => {
    if (event.anchorId !== anchorId) return;
    setState({
      outlet: event.outlet,
      headline: event.headline,
      label: event.label ?? "SOURCE",
      accent: event.accent,
      side: event.side,
      id: Date.now(),
      duration: event.durationMs ?? 6000,
    });
  });
  useHudEvent("ots.hide", (event) => {
    if (event.anchorId !== anchorId) return;
    setState(null);
  });

  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => setState(null), state.duration);
    return () => window.clearTimeout(t);
  }, [state?.id]);

  return (
    <AnimatePresence>
      {state ? (
        <motion.div
          key={state.id}
          className={`hud-ots hud-ots-${state.side}`}
          initial={{ x: state.side === "left" ? -60 : 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: state.side === "left" ? -30 : 30, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ borderTop: `4px solid ${state.accent}` }}
        >
          <div className="hud-ots-head">
            <div className="hud-ots-label" style={{ color: state.accent }}>
              {state.label}
            </div>
            <div className="hud-ots-outlet">{state.outlet}</div>
          </div>
          <div className="hud-ots-headline">{state.headline}</div>
          <motion.div
            className="hud-ots-footer"
            style={{ background: `linear-gradient(90deg, ${state.accent}, rgba(255,255,255,0.05))` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
