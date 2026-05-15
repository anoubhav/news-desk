import { AnimatePresence, motion } from "framer-motion";

interface AiConfidenceChipProps {
  /** Rolling average of fact-check confidence across the most recent turns, 0–100. */
  confidence: number | null;
  /** How many fact-checks contributed; used to gate render until at least one lands. */
  sampleCount: number;
}

function toneClass(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export function AiConfidenceChip({ confidence, sampleCount }: AiConfidenceChipProps) {
  const visible = confidence != null && sampleCount > 0;
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="ai-confidence-chip"
          className={`hud-confidence hud-confidence-${toneClass(confidence!)}`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="hud-confidence-pulse" aria-hidden="true" />
          <span className="hud-confidence-label">Live AI fact-check</span>
          <span className="hud-confidence-value">{Math.round(confidence!)}%</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
