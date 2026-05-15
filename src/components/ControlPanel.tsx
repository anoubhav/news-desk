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
                title={
                  mode === "demo_story"
                    ? "Use one of the built-in demo stories — fastest way to try the desk."
                    : mode === "article"
                      ? "Paste a public article URL and have the desk discuss it."
                      : "Pull the latest live news packet from the backend feed."
                }
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
                title={selected ? `Remove ${profile.label} from the desk.` : `Add ${profile.label} to the desk for this session.`}
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
            title="Spin up the selected presenters and open the live avatar stage."
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
              title="Paste a public article URL — the desk will read it before answering."
            />
            {articleError ? <p className="control-error">{articleError}</p> : null}
            <div className="control-actions">
              <button
                type="button"
                className="primary-action"
                onClick={onLoadArticle}
                disabled={loadingArticle}
                title="Fetch the article at this URL and use it as the story for the desk."
              >
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
                title={`Use "${story.title}" as the story for this desk session.`}
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
                title="Use the default fast model — quicker responses that fit the avatar's speaking window."
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
                      title={
                        effort === "low"
                          ? "Use low reasoning effort: fastest answers, least deliberation."
                          : effort === "medium"
                            ? "Use medium reasoning effort: balanced thinking time and speed."
                            : effort === "high"
                              ? "Use high reasoning effort: deeper thinking, slower replies."
                              : "Use maximum reasoning effort: deepest thinking, longest delays."
                      }
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
                  title={
                    tone === "calm"
                      ? "Use a calm debate tone: measured, low-heat, deliberate."
                      : tone === "balanced"
                        ? "Use a balanced debate tone: even-handed, no rhetoric."
                        : "Use an aggressive debate tone: punchy, opinionated, confrontational."
                  }
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
                  title={`Run ${roundCount} back-and-forth round${roundCount === 1 ? "" : "s"} between the selected presenters.`}
                >
                  {roundCount}
                </button>
              ))}
            </div>

            {debateConfig.debateRounds > 1 && selectedAnchors.length >= 3 ? (
              <div className="moderator-beat-row">
                <label
                  className="moderator-beat-toggle"
                  title="Insert a brief moderator turn between rounds when three or more presenters are on stage."
                >
                  <input
                    type="checkbox"
                    checked={debateConfig.includeModeratorBeat}
                    onChange={(event) => onModeratorBeatChange(event.target.checked)}
                    title="Insert a brief moderator turn between rounds when three or more presenters are on stage."
                  />
                  <span>Moderator beat between rounds</span>
                </label>
              </div>
            ) : null}

            {selectedAnchors.length > 1 ? (
              <details
                className="conversation-advanced"
                title="Open advanced controls for choosing which presenter speaks first."
              >
                <summary title="Open advanced controls for choosing which presenter speaks first.">Advanced order</summary>
                <div className="prompt-composer">
                  <label>Opening speaker</label>
                  <div className="toggle-row">
                    <button
                      type="button"
                      className={`toggle-chip ${debateConfig.openingSpeaker === "auto" ? "toggle-chip-selected" : ""}`}
                      onClick={() => onOpeningSpeakerChange("auto")}
                      title="Let the desk pick who speaks first based on the question."
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
                          title={`Have ${profile.label} open the conversation.`}
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
              <details
                key={anchorId}
                className="session-card"
                title={`Expand to see ${profile.label}'s live session status and runtime details.`}
              >
                <summary title={`Expand to see ${profile.label}'s live session status and runtime details.`}>
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
