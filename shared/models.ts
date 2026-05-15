export const anchorIds = ["neutral", "left", "right"] as const;
export const sourceTypes = ["demo_story", "article", "live_feed"] as const;
export const debateTonePresets = ["calm", "balanced", "aggressive"] as const;
export const debateRoundPresets = [1, 2, 3] as const;
export const modelPresets = ["default", "gpt-5.5"] as const;
export const reasoningEffortPresets = ["low", "medium", "high", "xhigh"] as const;

export type AnchorId = (typeof anchorIds)[number];
export type AnchorLean = AnchorId;
export type SourceType = (typeof sourceTypes)[number];
export type DebateTonePreset = (typeof debateTonePresets)[number];
export type DebateRoundPreset = (typeof debateRoundPresets)[number];
export type DebateOpeningSpeaker = "auto" | AnchorId;
export type ModelPreset = (typeof modelPresets)[number];
export type ReasoningEffort = (typeof reasoningEffortPresets)[number];

export interface LlmOverride {
  modelPreset?: ModelPreset;
  reasoningEffort?: ReasoningEffort;
}
export type SessionStatus = "idle" | "standby" | "connecting" | "ready" | "speaking" | "stopped";
export type ProviderMode = "mock" | "full-api";
export type AdSafetyState = "safe" | "caution" | "unsafe";
export type InteractionMode = "text" | "voice";
export type GenerationSource = "openai" | "gemini" | "template_fallback" | "article";
export type LivePacketStatus = "fresh" | "stale" | "upstream_error" | "invalid_contract" | "misconfigured";
export type LivePacketErrorCode = Exclude<LivePacketStatus, "fresh" | "stale">;
export type AnchorContextMode = "fixed" | "dynamic";
export type VoiceCaptureState = "idle" | "preparing" | "listening" | "transcribing" | "submitting" | "blocked";
export type ResponseGoal =
  | "latest_change"
  | "compare"
  | "catch_up"
  | "left_view"
  | "right_view"
  | "anchor_reply"
  | "custom";

export interface SourceEvidence {
  channel: string;
  lean: AnchorLean;
  timestamp: string;
  note: string;
}

export interface StoryPacket {
  id: string;
  title: string;
  story_id: string;
  sourceType: SourceType;
  sourceUpdatedAt?: string;
  event_time_window: string;
  topic: string;
  keywords_spiking: string[];
  neutral_summary: string;
  left_framing_summary: string;
  right_framing_summary: string;
  consensus_points: string[];
  divergence_points: string[];
  sentiment_by_cluster: Record<AnchorId, string>;
  ad_safety_state: AdSafetyState;
  confidence: number;
  source_evidence: SourceEvidence[];
  sourceUrl?: string;
  sourceTitle?: string;
  sourceDomain?: string;
  sourceSiteName?: string;
  sourceByline?: string;
  sourcePublishedAt?: string;
  articleBody?: string;
  articleSnippets?: string[];
  suggestedPrompts?: string[];
}

export interface AnchorRuntimeProfile {
  avatarId?: string;
  voiceId?: string;
  voiceFallbackNames: string[];
  contextId?: string;
  contextName: string;
  contextMode: AnchorContextMode;
}

export interface AnchorProfile {
  id: AnchorId;
  label: string;
  shortLabel: string;
  leaning: AnchorLean;
  accent: string;
  openingText: string;
  instructions: string;
  runtime: AnchorRuntimeProfile;
}

export interface AnchorRuntimeStatus {
  valid: boolean;
  sandbox: boolean;
  contextMode: AnchorContextMode;
  configuredAvatarId?: string;
  configuredVoiceId?: string;
  configuredContextId?: string;
  configuredContextName: string;
  voiceFallbackNames: string[];
  errors: string[];
}

export interface AnchorSession {
  anchorId: AnchorId;
  sessionId: string;
  status: SessionStatus;
  providerMode: ProviderMode;
  prewarmed: boolean;
  lazy: boolean;
  transcript: string;
  createdAt: string;
  updatedAt: string;
  lastEventType?: string;
  sandbox: boolean;
  isSelected: boolean;
  sessionAccessToken?: string;
  resolvedAvatarId?: string;
  resolvedVoiceId?: string;
  resolvedContextId?: string;
  liveReady?: boolean;
  startupError?: string;
}

export interface SessionEvent {
  id: string;
  anchorId: AnchorId;
  eventType: "avatar.speak_started" | "avatar.transcription" | "avatar.speak_ended";
  text?: string;
  timestamp: string;
  sourceEventId?: string | null;
}

export interface BrowserSessionStreamReadyEvent {
  type: "session.stream_ready";
  timestamp: string;
}

export interface BrowserSessionDisconnectedEvent {
  type: "session.disconnected";
  timestamp: string;
  reason: string;
}

export interface BrowserSessionStoppedEvent {
  type: "session.stopped";
  timestamp: string;
  stopReason: string;
  eventId?: string;
  sourceEventId?: string | null;
}

export interface BrowserAvatarSpeakStartedEvent {
  type: "avatar.speak_started";
  timestamp: string;
  eventId: string;
  sourceEventId?: string | null;
}

export interface BrowserAvatarTranscriptionEvent {
  type: "avatar.transcription";
  timestamp: string;
  eventId: string;
  sourceEventId?: string | null;
  text: string;
}

export interface BrowserAvatarSpeakEndedEvent {
  type: "avatar.speak_ended";
  timestamp: string;
  eventId: string;
  sourceEventId?: string | null;
}

export interface BrowserClientRuntimeErrorEvent {
  type: "client.runtime_error";
  timestamp: string;
  phase: "start" | "stream_wait" | "playback" | "attach";
  message: string;
}

export type BrowserSessionEvent =
  | BrowserSessionStreamReadyEvent
  | BrowserSessionDisconnectedEvent
  | BrowserSessionStoppedEvent
  | BrowserAvatarSpeakStartedEvent
  | BrowserAvatarTranscriptionEvent
  | BrowserAvatarSpeakEndedEvent
  | BrowserClientRuntimeErrorEvent;

export interface PriorTranscriptExcerpt {
  anchorId: AnchorId;
  text: string;
  roundIndex?: number;
}

export interface SessionTranscriptEntry {
  role: "host" | "anchor";
  anchorId?: AnchorId;
  anchorLabel?: string;
  text: string;
  roundIndex?: number;
  startedAt?: string;
  replyToAnchorId?: AnchorId;
}

export interface DebateConfig {
  tone: DebateTonePreset;
  openingSpeaker: DebateOpeningSpeaker;
  debateRounds: DebateRoundPreset;
  includeModeratorBeat: boolean;
}

export interface PriorFactCheck {
  anchorId: AnchorId;
  anchorLabel: string;
  confidence: number | null;
  claims: FactClaim[];
}

export interface PanelPacket {
  storyPacket: StoryPacket;
  selectedAnchors: AnchorId[];
  speakingOrder: AnchorId[];
  priorTranscriptExcerpts: PriorTranscriptExcerpt[];
  priorFactChecks?: PriorFactCheck[];
  sessionTranscript?: SessionTranscriptEntry[];
  responseGoal: ResponseGoal;
  debateConfig: DebateConfig;
  safetyGuardrail: string;
  confidence: number;
  closingDirective?: string;
}

export interface PanelTurn {
  turnId: string;
  anchorId: AnchorId;
  anchorLabel: string;
  responseGoal: ResponseGoal;
  transcript: string;
  citedEvidence: SourceEvidence[];
  generationSource: GenerationSource;
  priorAnchorId?: AnchorId;
  replyToAnchorId?: AnchorId;
  roundIndex: number;
  isModeratorBeat?: boolean;
  yielded?: boolean;
  yieldReason?: string;
  sourceExcerpt?: string;
  startedAt: string;
  completedAt: string;
  events: SessionEvent[];
  factCheck?: FactCheckResult;
}

export type ClaimVerdict = "verified" | "disputed" | "unverified" | "opinion";
export type FactCheckMode = "grounded" | "unavailable";

export interface FactSource {
  outlet: string;
  url: string;
  title?: string;
  snippet?: string;
}

export interface FactClaim {
  text: string;
  verdict: ClaimVerdict;
  rationale: string;
  sources: FactSource[];
}

export interface FactCheckResult {
  turnId: string;
  confidence: number | null;
  mode: FactCheckMode;
  claims: FactClaim[];
  generatedAt: string;
  unavailableReason?: string;
}

export interface FactCheckArticleContext {
  sourceUrl?: string;
  sourceTitle?: string;
  sourceDomain?: string;
  neutralSummary: string;
  lensFraming?: string;
  articleExcerpt?: string;
}

export interface FactCheckRequest {
  turnId: string;
  transcript: string;
  storyTitle: string;
  storyTopic: string;
  anchorLean: AnchorLean;
  articleContext?: FactCheckArticleContext;
}

export interface BootstrapResponse {
  anchors: AnchorProfile[];
  anchorRuntimeStatus: Record<AnchorId, AnchorRuntimeStatus>;
  sourceMode: SourceType;
  sessions: Record<AnchorId, AnchorSession>;
  selectedAnchors: AnchorId[];
  storyPacket: StoryPacket | null;
  availableStories: StoryPacket[];
  providerMode: ProviderMode;
  liveFeedEnabled: boolean;
  liveFeedPollMs: number;
  liveStatus: LivePacketResponse;
}

export interface SelectModeRequest {
  sourceMode: SourceType;
}

export interface SelectModeResponse {
  sourceMode: SourceType;
  sessions: Record<AnchorId, AnchorSession>;
  selectedAnchors: AnchorId[];
  storyPacket: StoryPacket | null;
  liveStatus: LivePacketResponse;
}

export interface SyncSessionsRequest {
  selectedAnchors: AnchorId[];
}

export interface SyncSessionsResponse {
  sessions: Record<AnchorId, AnchorSession>;
  selectedAnchors: AnchorId[];
}

export interface RefreshSessionRequest {
  anchorId: AnchorId;
}

export interface RefreshSessionResponse {
  session: AnchorSession;
  sessions: Record<AnchorId, AnchorSession>;
}

export interface ArticleLoadRequest {
  url: string;
}

export interface ArticleLoadResponse {
  storyPacket: StoryPacket;
  sessions: Record<AnchorId, AnchorSession>;
  selectedAnchors: AnchorId[];
}

export interface ArticleAskRequest {
  question: string;
  selectedAnchors?: AnchorId[];
  debateConfig?: Partial<DebateConfig>;
  sessionTranscript?: SessionTranscriptEntry[];
  llm?: LlmOverride;
}

export interface LivePacketResponse {
  storyPacket: StoryPacket | null;
  fetchedAt: string;
  status: LivePacketStatus;
  stale: boolean;
  upstreamAvailable: boolean;
  errorCode?: LivePacketErrorCode;
  errorMessage?: string;
  lastSuccessfulFetchedAt?: string;
}

export interface RelaySessionEventRequest {
  anchorId: AnchorId;
  sessionId: string;
  event: BrowserSessionEvent;
}

export interface RelaySessionEventResponse {
  accepted: boolean;
  ignoredReason?: "unknown_anchor" | "stale_session" | "duplicate_event" | "out_of_order";
  session: AnchorSession;
}

export interface SelectStoryRequest {
  storyId: string;
}

export interface SelectStoryResponse {
  storyPacket: StoryPacket;
}

export interface OrchestrateRequest {
  selectedAnchors?: AnchorId[];
  viewerPrompt: string;
  storyId?: string;
  debateConfig?: Partial<DebateConfig>;
  sessionTranscript?: SessionTranscriptEntry[];
  llm?: LlmOverride;
}

export interface VoiceTurnRequest {
  sourceMode: "article" | "live_feed";
  transcript: string;
  selectedAnchors?: AnchorId[];
  debateConfig?: Partial<DebateConfig>;
  sessionTranscript?: SessionTranscriptEntry[];
  llm?: LlmOverride;
}

export interface OrchestrateResponse {
  turns: PanelTurn[];
  storyPacket: StoryPacket;
  sessions: Record<AnchorId, AnchorSession>;
  selectedAnchors: AnchorId[];
}

export type OrchestrateStreamFrame =
  | {
      type: "session";
      storyPacket: StoryPacket;
      sessions: Record<AnchorId, AnchorSession>;
      selectedAnchors: AnchorId[];
    }
  | { type: "turn"; turn: PanelTurn }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PublicAvatarVoice {
  id?: string;
  name?: string;
  preview_url?: string;
}

export interface PublicAvatar {
  id: string;
  name: string;
  preview_url?: string;
  default_voice?: PublicAvatarVoice | null;
  type?: string;
  status?: string;
  is_1080p?: boolean;
}

export interface PublicAvatarsResponse {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: PublicAvatar[];
}

export interface AnchorRuntimeOverride {
  avatarId?: string;
  voiceId?: string;
}

export interface AnchorRuntimeConfigRequest {
  overrides: Partial<Record<AnchorId, AnchorRuntimeOverride>>;
}

export interface AnchorRuntimeConfigResponse {
  anchors: AnchorProfile[];
  sessions: Record<AnchorId, AnchorSession>;
  changedAnchors: AnchorId[];
}

export interface AvatarPreviewTokenRequest {
  avatarId: string;
  voiceId?: string;
}

export interface AvatarPreviewTokenResponse {
  sessionId: string;
  sessionAccessToken: string;
  sandbox: boolean;
}

export interface AvatarPreviewStopRequest {
  sessionId: string;
  sessionAccessToken: string;
}

export interface AvatarPreviewStopResponse {
  ok: true;
}

// ─── Highlight reel (Act 2) ───────────────────────────────────────────
// Per-turn webm clips are uploaded as the debate runs (see
// [src/lib/liveavatar.ts](src/lib/liveavatar.ts) attachRecorder). The picker
// scores them by citation density × divergence-keyword hit and emits a
// manifest, which the Hyperframes composition consumes.

export interface HighlightClipUploadResponse {
  ok: true;
  turnId: string;
  bytes: number;
}

export interface HighlightClipEntry {
  /** Matches PanelTurn.turnId. */
  turnId: string;
  anchorId: AnchorId;
  anchorLabel: string;
  /** Public URL the Hyperframes composition can <video src=…>. */
  clipUrl: string;
  durationSeconds: number;
  accent: string;
  /** First citation's outlet name, if any. */
  outlet?: string;
  /** First citation's headline, if any. */
  citationHeadline?: string;
  /** Short pull-quote text (sentence-ish) extracted from transcript. */
  pullQuote?: string;
}

export interface HighlightManifest {
  sessionId: string;
  topic: string;
  keywords: string[];
  consensusPoints: string[];
  divergencePoints: string[];
  /** Top N turns, ordered by roundIndex then anchor. */
  clips: HighlightClipEntry[];
}

export interface HighlightRenderResponse {
  ok: true;
  sessionId: string;
  manifestPath: string;
  mp4Url: string;
  durationSec: number;
}

// Newsroom HUD contextual content (Gemini-generated, falls back to deterministic
// extraction from the StoryPacket when the LLM is unavailable). Drives the
// scrolling lower-third ticker and the BREAKING bar so they reflect the
// current story rather than static demo strings.
export interface HudContext {
  /** Pipe-separated when serialized to the Hyperframes ticker. */
  tickerItems: string[];
  /** Short left-badge label, e.g. "LIVE", "BREAKING". */
  tickerLabel: string;
  /** Single uppercased headline for the BREAKING bar. */
  breakingHeadline: string;
  /** Short kicker chip text, e.g. "BREAKING", "DEVELOPING". */
  breakingKicker: string;
}

export interface HudContextResponse {
  context: HudContext;
  /** Echoed so the client can confirm which story the response describes. */
  storyId: string;
  /** "gemini" when generated, "fallback" when extracted from the packet. */
  source: "gemini" | "fallback";
}
