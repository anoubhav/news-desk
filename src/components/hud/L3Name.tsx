import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AnchorId } from "@shared/models";
import { useHudEvent } from "../../lib/hudBus";

type Props = { anchorId: AnchorId; side?: "left" | "right" };

type State = { name: string; role: string; accent: string; id: number; duration: number };

/**
 * Per-anchor lower-third name plate. Mirrors
 * hyperframes/compositions/components/l3-name.html. Pinned inside an
 * AnchorCard; visible while that anchor is speaking.
 */
export function L3Name({ anchorId, side = "left" }: Props) {
  const [state, setState] = useState<State | null>(null);

  useHudEvent("l3.show", (event) => {
    if (event.anchorId !== anchorId) return;
    setState({ name: event.name, role: event.role, accent: event.accent, id: Date.now(), duration: event.durationMs });
  });
  useHudEvent("l3.hide", (event) => {
    if (event.anchorId !== anchorId) return;
    setState(null);
  });

  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => setState(null), state.duration);
    return () => window.clearTimeout(t);
  }, [state?.id]);

  const fromX = side === "right" ? 60 : -60;

  return (
    <AnimatePresence>
      {state ? (
        <motion.div
          key={state.id}
          className={`hud-l3 hud-l3-${side}`}
          initial={{ x: fromX, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: fromX * 0.5, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ borderLeft: `8px solid ${state.accent}` }}
        >
          <div className="hud-l3-name">{state.name}</div>
          <div className="hud-l3-role" style={{ color: state.accent }}>
            {state.role}
          </div>
          <motion.div
            className="hud-l3-stripe"
            style={{ background: state.accent }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
