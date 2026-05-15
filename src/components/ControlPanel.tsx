import type {
  AnchorId,
  AnchorProfile,
  AnchorRuntimeStatus,
  AnchorSession,
  DebateConfig,
  LlmOverride,
  ModelPreset,
  ReasoningEffort,
  SourceType,
  StoryPacket,
  VoiceCaptureState,
} from "@shared/models";
import { debateRoundPresets, debateTonePresets, reasoningEffortPresets } from "@shared/models";
import { StoryInspector } from "./StoryInspector";

interface LiveStatus {
  fetchedAt?: string;
  status: string;
  stale: boolean;
  upstreamAvailable: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  lastSuccessfulFetchedAt?: string | null;
}

interface ControlPanelProps {
  sourceMode: SourceType;
  liveFeedEnabled: boolean;
  liveStatus: LiveStatus;
  loadingLivePacket: boolean;
  articleUrl: string;
  articleError?: string | null;
  loadingArticle: boolean;
  selectedAnchors: AnchorId[];
  currentStoryId: string;
  stories: StoryPacket[];
  storyPacket: StoryPacket | null;
  anchors: AnchorProfile[];
  anchorRuntimeStatus: Record<AnchorId, AnchorRuntimeStatus> | null;
  sessions: Record<AnchorId, AnchorSession>;
  debateConfig: DebateConfig;
  llmConfig: LlmOverride;
  busy: boolean;
  connecting: boolean;
  voiceCaptureState: VoiceCaptureState;
  onSourceModeChange: (nextMode: SourceType) => void;
  onArticleUrlChange: (nextUrl: string) => void;
  onLoadArticle: () => void;
  onToggleAnchor: (anchorId: AnchorId) => void;
  onSelectStory: (storyId: string) => void;
  onStartStage: () => void;
  onDebateToneChange: (nextTone: DebateConfig["tone"]) => void;
  onOpeningSpeakerChange: (nextOpeningSpeaker: DebateConfig["openingSpeaker"]) => void;
  onDebateRoundsChange: (nextRounds: DebateConfig["debateRounds"]) => void;
  onModeratorBeatChange: (next: boolean) => void;
  onLlmConfigChange: (next: LlmOverride) => void;
  onOpenAvatarGallery?: () => void;
}

function formatLiveStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function formatTimeAgo(isoTimestamp: string | undefined | null) {
  if (!isoTimestamp) return null;
  const ts = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffSeconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function getLiveBannerCopy(liveStatus: LiveStatus): { tone: "fresh" | "warn" | "error" | "info"; text: string } | null {
  switch (liveStatus.status) {
    case "fresh": return null;
    case "stale": {
      const ts = liveStatus.lastSuccessfulFetchedAt ?? liveStatus.fetchedAt;
      const ago = formatTimeAgo(ts);
      return { tone: "warn", text: ago ? `⚠ Live feed is stale (last update ${ago} ago)` : "⚠ Live feed is stale" };
    }
    case "upstream_error":
      return { tone: "error", text: "⚠ Upstream live feed error — showing cached data" };
    case "invalid_contract":
      return { tone: "error", text: "⚠ Upstream returned malformed data" };
    case "misconfigured":
      return { tone: "info", text: "Live feed not configured (set LIVE_SOURCE_API_URL)" };
    default: return null;
  }
}

function describeSessionSummary(session: AnchorSession) {
  if (session.startupError) return session.startupError;
  if (session.status === "standby") return "Waiting for this presenter's turn.";
  if (session.liveReady) return "Feed ready";
  if (session.providerMode === "full-api" && session.sessionAccessToken) return "Session token ready";
  return session.prewarmed ? "Prewarmed" : "On demand";
}

export function ControlPanel({
  sourceMode,
  liveFeedEnabled,
  liveStatus,
  loadingLivePacket,
  articleUrl,
  articleError,
  loadingArticle,
  selectedAnchors,
  currentStoryId,
  stories,
  storyPacket,
  anchors,
  anchorRuntimeStatus,
  sessions,
  debateConfig,
  llmConfig,
  busy,
  connecting,
  voiceCaptureState,
  onSourceModeChange,
  onArticleUrlChange,
  onLoadArticle,
  onToggleAnchor,
  onSelectStory,
  onStartStage,
  onDebateToneChange,
  onOpeningSpeakerChange,
  onDebateRoundsChange,
  onModeratorBeatChange,
  onLlmConfigChange,
  onOpenAvatarGallery,
}: ControlPanelProps) {
  const activeModelPreset: ModelPreset = llmConfig.modelPreset === "gpt-5.5" ? "gpt-5.5" : "default";
  const activeReasoningEffort: ReasoningEffort = llmConfig.reasoningEffort ?? "medium";

  function handleModelPresetChange(next: ModelPreset) {
    if (next === activeModelPreset) return;
    if (next === "gpt-5.5") {
      onLlmConfigChange({ modelPreset: "gpt-5.5", reasoningEffort: activeReasoningEffort });
    } else {
      onLlmConfigChange({ modelPreset: "default" });
    }
  }

  function handleReasoningEffortChange(next: ReasoningEffort) {
    if (next === activeReasoningEffort) return;
    onLlmConfigChange({ modelPreset: "gpt-5.5", reasoningEffort: next });
  }

  const articleReady = Boolean(storyPacket && storyPacket.sourceType === "article");
  const orderedAnchorIds = [
    ...selectedAnchors,
    ...anchors.map((profile) => profile.id).filter((anchorId) => !selectedAnchors.includes(anchorId)),
  ];
  const controlsBusy = busy || connecting || voiceCaptureState !== "idle";
  const showConversationSetup = sourceMode !== "demo_story";

  return (
    <div className="control-panel">
      <section className="control-panel-section">
        <p className="eyebrow">Mode</p>
        <div className="toggle-row">
          {(["demo_story", "article", "live_feed"] as const).map((mode) => {
            const disabled = mode === "live_feed" && !liveFeedEnabled;
            return (
              <button
                key={mode}
                type="button"
                className={`toggle-chip ${sourceMode === mode ? "toggle-chip-selected" : ""}`}
                onClick={() => onSourceModeChange(mode)}
                disabled={disabled}
              >
                {mode === "demo_story" ? "Demo" : mode === "article" ? "Article" : "Live"}
              </button>
            );
          })}
        </div>
      </section>

      <section className="control-panel-section">
        <p className="eyebrow">Presenters</p>
        <div className="toggle-row">
          {anchors.map((profile) => {
            const selected = selectedAnchors.includes(profile.id);
            return (
              <button
                key={profile.id}
                type="button"
                className={`toggle-chip ${selected ? "toggle-chip-selected" : ""}`}
                onClick={() => onToggleAnchor(profile.id)}
              >
                {profile.shortLabel}
              </button>
            );
          })}
        </div>
        <div className="control-actions">
          {onOpenAvatarGallery ? (
            <button
              type="button"
              className="secondary-action"
              onClick={onOpenAvatarGallery}
              disabled={controlsBusy}
              title="Browse public avatars and assign one per anchor"
            >
              Choose avatars
            </button>
          ) : null}
          <button
            type="button"
            className="primary-action start-stage-button"
            onClick={onStartStage}
            disabled={(sourceMode === "article" && !articleReady) || controlsBusy}
          >
            {connecting ? "Preparing stage…" : "Start stage"}
          </button>
        </div>
      </section>

      <section className="control-panel-section">
        <p className="eyebrow">
          {sourceMode === "article" ? "Article source" : sourceMode === "live_feed" ? "Live source" : "Story picker"}
        </p>

        {sourceMode === "article" ? (
          <div className="prompt-composer">
            <label htmlFor="articleUrl">Public article URL</label>
            <input
              id="articleUrl"
              type="url"
              value={articleUrl}
              placeholder="https://example.com/article"
              onChange={(event) => onArticleUrlChange(event.target.value)}
            />
            {articleError ? <p className="control-error">{articleError}</p> : null}
            <div className="control-actions">
              <button type="button" className="primary-action" onClick={onLoadArticle} disabled={loadingArticle}>
                {loadingArticle ? "Loading article…" : "Load article"}
              </button>
            </div>
          </div>
        ) : sourceMode === "live_feed" ? (
          <div className="live-status-card">
            {(() => {
              const banner = getLiveBannerCopy(liveStatus);
              return banner ? (
                <div className={`live-status-banner live-status-banner-${banner.tone}`} role="status">
                  {banner.text}
                </div>
              ) : null;
            })()}
            <strong>
              {loadingLivePacket
                ? "Refreshing live packet…"
                : liveStatus.status === "fresh"
                  ? "Live packet ready"
                  : liveStatus.status === "stale"
                    ? "Using stale live packet"
                    : formatLiveStatusLabel(liveStatus.status)}
            </strong>
            <span>{liveStatus.upstreamAvailable ? "Upstream available" : "Upstream unavailable"}</span>
            {liveStatus.fetchedAt ? <small>Last fetch: {new Date(liveStatus.fetchedAt).toLocaleTimeString()}</small> : null}
            {liveStatus.lastSuccessfulFetchedAt ? (
              <small>Last healthy: {new Date(liveStatus.lastSuccessfulFetchedAt).toLocaleTimeString()}</small>
            ) : null}
            {liveStatus.errorCode ? <small>Error: {liveStatus.errorCode}</small> : null}
            {liveStatus.errorMessage ? <p>{liveStatus.errorMessage}</p> : null}
          </div>
        ) : (
          <div className="story-list">
            {stories.map((story) => (
              <button
                key={story.id}
                type="button"
                className={`story-chip ${story.id === currentStoryId ? "story-chip-active" : ""}`}
                onClick={() => onSelectStory(story.id)}
              >
                <span>{story.title}</span>
                <small>{story.event_time_window}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {showConversationSetup ? (
        <section className="control-panel-section">
          <p className="eyebrow">Conversation style</p>
          <div className="prompt-composer">
            <label>Model</label>
            <div className="toggle-row" role="group" aria-label="Model preset">
              <button
                type="button"
                className={`toggle-chip ${activeModelPreset === "default" ? "toggle-chip-selected" : ""}`}
                onClick={() => handleModelPresetChange("default")}
                aria-pressed={activeModelPreset === "default"}
              >
                Default
              </button>
              <button
                type="button"
                className={`toggle-chip ${activeModelPreset === "gpt-5.5" ? "toggle-chip-selected" : ""}`}
                onClick={() => handleModelPresetChange("gpt-5.5")}
                aria-pressed={activeModelPreset === "gpt-5.5"}
                title="Smarter responses with reasoning. Slower; fits inside the 10–15s avatar speaking window."
              >
                GPT-5.5 (smarter)
              </button>
            </div>

            {activeModelPreset === "gpt-5.5" ? (
              <>
                <label>Reasoning effort</label>
                <div className="toggle-row" role="group" aria-label="Reasoning effort">
                  {reasoningEffortPresets.map((effort) => (
                    <button
                      key={`effort-${effort}`}
                      type="button"
                      className={`toggle-chip ${activeReasoningEffort === effort ? "toggle-chip-selected" : ""}`}
                      onClick={() => handleReasoningEffortChange(effort)}
                      aria-pressed={activeReasoningEffort === effort}
                    >
                      {effort[0].toUpperCase() + effort.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <label>Debate tone</label>
            <div className="toggle-row">
              {debateTonePresets.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  className={`toggle-chip ${debateConfig.tone === tone ? "toggle-chip-selected" : ""}`}
                  onClick={() => onDebateToneChange(tone)}
                >
                  {tone[0].toUpperCase() + tone.slice(1)}
                </button>
              ))}
            </div>

            <label>Rounds</label>
            <div className="toggle-row" role="group" aria-label="Debate rounds">
              {debateRoundPresets.map((roundCount) => (
                <button
                  key={`rounds-${roundCount}`}
                  type="button"
                  className={`toggle-chip ${debateConfig.debateRounds === roundCount ? "toggle-chip-selected" : ""}`}
                  onClick={() => onDebateRoundsChange(roundCount)}
                  aria-pressed={debateConfig.debateRounds === roundCount}
                >
                  {roundCount}
                </button>
              ))}
            </div>

            {debateConfig.debateRounds > 1 && selectedAnchors.length >= 3 ? (
              <div className="moderator-beat-row">
                <label className="moderator-beat-toggle">
                  <input
                    type="checkbox"
                    checked={debateConfig.includeModeratorBeat}
                    onChange={(event) => onModeratorBeatChange(event.target.checked)}
                  />
                  <span>Moderator beat between rounds</span>
                </label>
              </div>
            ) : null}

            {selectedAnchors.length > 1 ? (
              <details className="conversation-advanced">
                <summary>Advanced order</summary>
                <div className="prompt-composer">
                  <label>Opening speaker</label>
                  <div className="toggle-row">
                    <button
                      type="button"
                      className={`toggle-chip ${debateConfig.openingSpeaker === "auto" ? "toggle-chip-selected" : ""}`}
                      onClick={() => onOpeningSpeakerChange("auto")}
                    >
                      Auto
                    </button>
                    {selectedAnchors.map((anchorId) => {
                      const profile = anchors.find((entry) => entry.id === anchorId);
                      if (!profile) return null;
                      return (
                        <button
                          key={`opening-${profile.id}`}
                          type="button"
                          className={`toggle-chip ${debateConfig.openingSpeaker === profile.id ? "toggle-chip-selected" : ""}`}
                          onClick={() => onOpeningSpeakerChange(profile.id)}
                        >
                          {profile.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="control-panel-section">
        <p className="eyebrow">Session status</p>
        <div className="session-list">
          {orderedAnchorIds.map((anchorId) => {
            const profile = anchors.find((entry) => entry.id === anchorId);
            const session = sessions[anchorId];
            const runtime = anchorRuntimeStatus?.[anchorId];
            if (!profile) return null;

            return (
              <details key={anchorId} className="session-card">
                <summary>
                  <div>
                    <strong>{profile.label}</strong>
                    <span>{selectedAnchors.includes(anchorId) ? "Selected" : "Standby"}</span>
                  </div>
                  <span className={`status-pill status-${session.status}`}>{session.status}</span>
                </summary>
                <div className="session-card-body">
                  <p className="session-summary">{describeSessionSummary(session)}</p>
                  <dl className="session-meta">
                    <div>
                      <dt>Provider</dt>
                      <dd>{session.providerMode === "mock" ? "Mock" : "LiveAvatar"}</dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>{session.prewarmed ? "Prewarmed" : "On demand"}</dd>
                    </div>
                    <div>
                      <dt>Runtime</dt>
                      <dd>{session.sandbox ? "Sandbox" : "Production"}</dd>
                    </div>
                    <div>
                      <dt>Context</dt>
                      <dd>{runtime?.configuredContextName ?? profile.runtime.contextName}</dd>
                    </div>
                  </dl>
                  {runtime && !runtime.valid ? <p className="control-error">{runtime.errors.join(" ")}</p> : null}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="control-panel-section">
        <p className="eyebrow">Story context</p>
        <StoryInspector sourceMode={sourceMode} storyPacket={storyPacket} liveStatus={liveStatus} variant="detail" />
      </section>
    </div>
  );
}
