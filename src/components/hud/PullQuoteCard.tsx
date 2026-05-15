import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useHudEvent } from "../../lib/hudBus";

type State = { quote: string; attribution: string; accent: string; id: number };

/**
 * Fullscreen pull-quote card. Mirrors
 * hyperframes/compositions/components/pull-quote.html.
 */
export function PullQuoteCard() {
  const [state, setState] = useState<State | null>(null);

  useHudEvent("pullQuote.show", (event) => {
    setState({ quote: event.quote, attribution: event.attribution, accent: event.accent, id: Date.now() });
  });
  useHudEvent("pullQuote.hide", () => setState(null));

  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => setState(null), 4500);
    return () => window.clearTimeout(t);
  }, [state?.id]);

  return (
    <AnimatePresence>
      {state ? (
        <motion.div
          key={state.id}
          className="hud-pullquote-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="hud-pullquote-card"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="hud-pullquote-open" style={{ color: state.accent }}>
              &ldquo;
            </div>
            <div className="hud-pullquote-text">{state.quote}</div>
            <motion.div
              className="hud-pullquote-rule"
              style={{ background: state.accent }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            />
            <div className="hud-pullquote-attribution" style={{ color: state.accent }}>
              {state.attribution}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
