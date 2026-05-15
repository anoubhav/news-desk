import type { SourceType, StoryPacket } from "@shared/models";

interface LiveStatus {
  fetchedAt?: string;
  status: string;
  stale: boolean;
  upstreamAvailable: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  lastSuccessfulFetchedAt?: string | null;
}

interface StoryInspectorProps {
  sourceMode: SourceType;
  storyPacket: StoryPacket | null;
  liveStatus: LiveStatus;
  variant?: "compact" | "detail";
}

function renderSafetyFlag(storyPacket: StoryPacket) {
  return (
    <div className={`safety-flag safety-${storyPacket.ad_safety_state}`}>
      {storyPacket.ad_safety_state} • {Math.round(storyPacket.confidence * 100)}%
    </div>
  );
}

function buildCompactMeta(sourceMode: SourceType, storyPacket: StoryPacket, liveStatus: LiveStatus) {
  if (sourceMode === "article") {
    return storyPacket.sourceSiteName ?? storyPacket.sourceDomain ?? "Loaded article";
  }

  if (sourceMode === "live_feed") {
    if (storyPacket.sourceUpdatedAt) {
      return `Updated ${new Date(storyPacket.sourceUpdatedAt).toLocaleTimeString()}`;
    }

    return liveStatus.status.replaceAll("_", " ");
  }

  return storyPacket.event_time_window;
}

function renderCompactState(sourceMode: SourceType, storyPacket: StoryPacket | null, liveStatus: LiveStatus) {
  if (sourceMode === "article" && (!storyPacket || storyPacket.sourceType !== "article")) {
    return (
      <section className="story-summary-card">
        <div className="story-summary-header">
          <div>
            <p className="eyebrow">Story context</p>
            <h2>No article loaded</h2>
          </div>
        </div>
        <p className="story-summary-line">Open Context & settings to load a public article before asking the desk.</p>
      </section>
    );
  }

  if (sourceMode === "live_feed" && (!storyPacket || storyPacket.sourceType !== "live_feed")) {
    return (
      <section className="story-summary-card">
        <div className="story-summary-header">
          <div>
            <p className="eyebrow">Story context</p>
            <h2>Waiting for live packet</h2>
          </div>
          <div className="story-meta-chip">{liveStatus.status.replaceAll("_", " ")}</div>
        </div>
        <p className="story-summary-line">The desk will update as soon as the backend delivers a usable live packet.</p>
      </section>
    );
  }

  if (!storyPacket) {
    return null;
  }

  return (
    <section className="story-summary-card">
      <div className="story-summary-header">
        <div>
          <p className="eyebrow">{storyPacket.sourceType === "article" ? "Loaded article" : "Current story"}</p>
          <h2>{storyPacket.sourceTitle ?? storyPacket.title}</h2>
        </div>
        {renderSafetyFlag(storyPacket)}
      </div>
      <div className="story-summary-meta">
        <span className="story-meta-chip">{buildCompactMeta(sourceMode, storyPacket, liveStatus)}</span>
        {storyPacket.sourceType === "article" && storyPacket.sourcePublishedAt ? (
          <span className="story-meta-chip">{storyPacket.sourcePublishedAt}</span>
        ) : null}
      </div>
      <p className="story-summary-line">{storyPacket.neutral_summary}</p>
    </section>
  );
}

function renderDetailState(sourceMode: SourceType, storyPacket: StoryPacket | null, liveStatus: LiveStatus) {
  if (sourceMode === "article" && (!storyPacket || storyPacket.sourceType !== "article")) {
    return (
      <section className="story-context">
        <header className="section-header section-header-wide">
          <div>
            <p className="eyebrow">Loaded article</p>
            <h2>No article loaded</h2>
          </div>
        </header>
        <p className="empty-state">Paste a public article URL in this drawer to ground the desk before asking follow-up questions.</p>
      </section>
    );
  }

  if (sourceMode === "live_feed" && (!storyPacket || storyPacket.sourceType !== "live_feed")) {
    return (
      <section className="story-context">
        <header className="section-header section-header-wide">
          <div>
            <p className="eyebrow">Current live packet</p>
            <h2>No live packet yet</h2>
          </div>
        </header>
        <div className="live-status-card">
          <strong>{liveStatus.status.replaceAll("_", " ")}</strong>
          <span>{liveStatus.upstreamAvailable ? "Upstream available" : "Upstream unavailable"}</span>
          {liveStatus.fetchedAt ? <small>Last fetch: {new Date(liveStatus.fetchedAt).toLocaleTimeString()}</small> : null}
          {liveStatus.lastSuccessfulFetchedAt ? (
            <small>Last healthy fetch: {new Date(liveStatus.lastSuccessfulFetchedAt).toLocaleTimeString()}</small>
          ) : null}
          {liveStatus.errorCode ? <small>Error code: {liveStatus.errorCode}</small> : null}
          {liveStatus.errorMessage ? <p>{liveStatus.errorMessage}</p> : null}
        </div>
      </section>
    );
  }

  if (!storyPacket) {
    return null;
  }

  if (storyPacket.sourceType === "article") {
    return (
      <section className="story-context">
        <header className="section-header section-header-wide">
          <div>
            <p className="eyebrow">Loaded article</p>
            <h2>{storyPacket.sourceTitle ?? storyPacket.title}</h2>
          </div>
          {renderSafetyFlag(storyPacket)}
        </header>

        <div className="story-detail-columns">
          <article className="story-detail-card">
            <h3>Source</h3>
            <ul className="meta-list">
              <li>{storyPacket.sourceSiteName ?? storyPacket.sourceDomain ?? "Unknown site"}</li>
              {storyPacket.sourceByline ? <li>Byline: {storyPacket.sourceByline}</li> : null}
              {storyPacket.sourcePublishedAt ? <li>Published: {storyPacket.sourcePublishedAt}</li> : null}
              {storyPacket.sourceUrl ? (
                <li>
                  <a
                    href={storyPacket.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the original article in a new browser tab."
                  >
                    Open source article
                  </a>
                </li>
              ) : null}
            </ul>
          </article>

          <article className="story-detail-card">
            <h3>Neutral grounding</h3>
            <p>{storyPacket.neutral_summary}</p>
            {storyPacket.keywords_spiking.length > 0 ? (
              <div className="tag-row">
                {storyPacket.keywords_spiking.map((keyword) => (
                  <span key={keyword} className="keyword-pill">
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        </div>

        {storyPacket.source_evidence.length > 0 ? (
          <details
            className="detail-card"
            title="Expand to see the news clips and notes that grounded the desk's framing of this article."
          >
            <summary title="Expand to see the news clips and notes that grounded the desk's framing of this article.">
              Source evidence ({storyPacket.source_evidence.length})
            </summary>
            <div className="detail-card-body">
              <div className="evidence-list">
                {storyPacket.source_evidence.map((evidence) => (
                  <div key={`${evidence.channel}-${evidence.timestamp}`} className="evidence-item">
                    <strong>{evidence.channel}</strong>
                    <span>{evidence.lean}</span>
                    <small>{new Date(evidence.timestamp).toLocaleTimeString()}</small>
                    <p>{evidence.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ) : null}

        {(storyPacket.articleSnippets ?? []).length > 0 ? (
          <details
            className="detail-card"
            title="Expand to see short passages pulled directly from the loaded article."
          >
            <summary title="Expand to see short passages pulled directly from the loaded article.">
              Extracted snippets ({storyPacket.articleSnippets?.length ?? 0})
            </summary>
            <div className="detail-card-body">
              <div className="evidence-list">
                {(storyPacket.articleSnippets ?? []).map((snippet, index) => (
                  <div key={`${storyPacket.id}-snippet-${index + 1}`} className="evidence-item">
                    <strong>Snippet {index + 1}</strong>
                    <p>{snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ) : null}

        {storyPacket.articleBody ? (
          <details
            className="detail-card"
            title="Expand to read a longer excerpt of the loaded article body."
          >
            <summary title="Expand to read a longer excerpt of the loaded article body.">Article excerpt</summary>
            <div className="detail-card-body">
              <p className="article-body-preview">{storyPacket.articleBody}</p>
            </div>
          </details>
        ) : null}
      </section>
    );
  }

  return (
    <section className="story-context">
      <header className="section-header section-header-wide">
        <div>
          <p className="eyebrow">{storyPacket.sourceType === "live_feed" ? "Current live packet" : "Current story packet"}</p>
          <h2>{storyPacket.title}</h2>
          {storyPacket.sourceType === "live_feed" ? (
            <p className="live-story-meta">
              {storyPacket.sourceUpdatedAt ? `Source update: ${new Date(storyPacket.sourceUpdatedAt).toLocaleTimeString()}` : "Live packet loaded"}
              {liveStatus.fetchedAt ? ` • Fetched: ${new Date(liveStatus.fetchedAt).toLocaleTimeString()}` : ""}
              {liveStatus.lastSuccessfulFetchedAt ? ` • Healthy: ${new Date(liveStatus.lastSuccessfulFetchedAt).toLocaleTimeString()}` : ""}
              {liveStatus.stale ? " • Stale fallback" : liveStatus.upstreamAvailable ? " • Upstream live" : ""}
            </p>
          ) : null}
        </div>
        {renderSafetyFlag(storyPacket)}
      </header>

      <div className="story-detail-grid">
        <article className="story-detail-card">
          <h3>Neutral baseline</h3>
          <p>{storyPacket.neutral_summary}</p>
        </article>
        <article className="story-detail-card">
          <h3>Left framing</h3>
          <p>{storyPacket.left_framing_summary}</p>
        </article>
        <article className="story-detail-card">
          <h3>Right framing</h3>
          <p>{storyPacket.right_framing_summary}</p>
        </article>
      </div>

      {storyPacket.keywords_spiking.length > 0 ? (
        <div className="tag-row">
          {storyPacket.keywords_spiking.map((keyword) => (
            <span key={keyword} className="keyword-pill">
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      <div className="story-detail-columns">
        <article className="story-detail-card">
          <h3>Shared narrative</h3>
          <ul>
            {storyPacket.consensus_points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </article>
        <article className="story-detail-card">
          <h3>Where framing splits</h3>
          <ul>
            {storyPacket.divergence_points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </article>
      </div>

      <details
        className="detail-card"
        title="Expand to see the news clips and notes that shaped the desk's view of this story."
      >
        <summary title="Expand to see the news clips and notes that shaped the desk's view of this story.">
          Source evidence ({storyPacket.source_evidence.length})
        </summary>
        <div className="detail-card-body">
          <div className="evidence-list">
            {storyPacket.source_evidence.map((evidence) => (
              <div key={`${evidence.channel}-${evidence.timestamp}`} className="evidence-item">
                <strong>{evidence.channel}</strong>
                <span>{evidence.lean}</span>
                <small>{new Date(evidence.timestamp).toLocaleTimeString()}</small>
                <p>{evidence.note}</p>
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}

export function StoryInspector({
  sourceMode,
  storyPacket,
  liveStatus,
  variant = "detail",
}: StoryInspectorProps) {
  return variant === "compact"
    ? renderCompactState(sourceMode, storyPacket, liveStatus)
    : renderDetailState(sourceMode, storyPacket, liveStatus);
}
