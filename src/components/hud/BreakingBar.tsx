import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useHudEvent } from "../../lib/hudBus";

type BreakingState = {
  kicker: string;
  text: string;
  accent: string;
  id: number;
};

/**
 * Pulsing red top bar. Mirrors hyperframes/compositions/components/breaking-bar.html.
 * Triggered via hudBus `breaking.show` / `breaking.hide`. Auto-hides after
 * `durationMs` (default 5000ms).
 */
export function BreakingBar() {
  const [state, setState] = useState<BreakingState | null>(null);

  useHudEvent("breaking.show", (event) => {
    setState({
      kicker: event.kicker,
      text: event.text,
      accent: event.accent ?? "#FF3A4A",
      id: Date.now(),
    });
  });
  useHudEvent("breaking.hide", () => setState(null));

  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => setState(null), 5000);
    return () => window.clearTimeout(t);
  }, [state?.id]);

  return (
    <AnimatePresence>
      {state ? (
        <motion.div
          key={state.id}
          className="hud-breaking"
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: `linear-gradient(90deg, ${state.accent} 0%, #c81a2a 100%)`,
            boxShadow: `0 8px 26px ${state.accent}55`,
          }}
        >
          <div className="hud-breaking-kicker">
            <motion.span
              className="hud-breaking-pulse"
              style={{ background: state.accent, boxShadow: `0 0 12px ${state.accent}` }}
              animate={{ opacity: [1, 0.45, 1] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            />
            <span>{state.kicker}</span>
          </div>
          <div className="hud-breaking-text">{state.text}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
