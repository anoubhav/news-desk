import type { ClaimVerdict, FactCheckResult } from "@shared/models";

export type FactCheckCardState =
  | { status: "loading" }
  | { status: "ready"; result: FactCheckResult }
  | { status: "error"; message: string };

interface FactCheckCardProps {
  state?: FactCheckCardState;
}

const verdictLabel: Record<ClaimVerdict, string> = {
  verified: "Verified",
  disputed: "Disputed",
  unverified: "Unverified",
  opinion: "Opinion",
};

function confidenceTone(confidence: number | null): "high" | "medium" | "low" | "unknown" {
  if (confidence == null) return "unknown";
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export function shouldRenderFactCheck(state?: FactCheckCardState): boolean {
  if (!state) return false;
  if (state.status === "loading") return true;
  if (state.status === "error") return false;
  const { result } = state;
  if (result.mode === "unavailable") return false;
  return result.claims.length > 0 || result.confidence != null;
}

export function FactCheckCard({ state }: FactCheckCardProps) {
  if (!state) return null;

  if (state.status === "loading") {
    return (
      <div className="factcheck-card factcheck-card-loading" aria-live="polite">
        <header className="factcheck-card-header">
          <span className="factcheck-pill factcheck-pill-loading">Fact-checking…</span>
        </header>
        <div className="factcheck-shimmer" aria-hidden="true" />
        <div className="factcheck-shimmer factcheck-shimmer-short" aria-hidden="true" />
      </div>
    );
  }

  if (state.status === "error") {
    return null;
  }

  const { result } = state;
  if (result.mode === "unavailable") return null;
  if (result.claims.length === 0 && result.confidence == null) return null;

  const tone = confidenceTone(result.confidence);

  return (
    <div className="factcheck-card" aria-live="polite">
      <header className="factcheck-card-header">
        <span className="factcheck-label">Live fact-check</span>
        {result.confidence != null ? (
          <span className={`factcheck-pill factcheck-pill-${tone}`}>
            {result.confidence}% confidence
          </span>
        ) : null}
      </header>

      {result.claims.length > 0 ? (
        <ul className="factcheck-claims">
          {result.claims.map((claim, index) => (
            <li key={index} className={`factcheck-claim factcheck-claim-${claim.verdict}`}>
              <div className="factcheck-claim-row">
                <span className={`factcheck-verdict factcheck-verdict-${claim.verdict}`}>
                  {verdictLabel[claim.verdict]}
                </span>
                <p className="factcheck-claim-text">{claim.text}</p>
              </div>
              {claim.rationale ? <p className="factcheck-rationale">{claim.rationale}</p> : null}
              {claim.sources.length > 0 ? (
                <div className="factcheck-sources">
                  {claim.sources.map((source) => (
                    <a
                      key={source.url}
                      className="factcheck-source"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      title={source.title ?? source.url}
                    >
                      {source.outlet}
                    </a>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
