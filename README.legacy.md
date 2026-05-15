# LiveAvatar Election Desk

Viewer-facing prototype for a flexible `LiveAvatar FULL Mode` news desk with three source modes:

- `Real Live Feed`: local app polls your backend API for the latest multi-channel intelligence packet
- `Live Article Anchor`: real article URL -> extracted article context -> neutral spoken anchor
- `Election Desk Demo`: sample multi-anchor packets for neutral / left / right panel behavior

The live feed path is the primary multi-anchor real-data entry point. Article mode and demo mode remain available as fallbacks.

The multi-anchor side is built around three `LiveAvatar FULL Mode` identities:

- `Neutral Desk`
- `Left Lens`
- `Right Lens`

The viewer can stage any anchor combination at runtime, and the panel runs through moderated turn-taking so one anchor speaks at a time while later anchors reply to prior anchor transcripts.

## What Is Implemented

- Project-local install of `heygen-com/liveavatar-agent-skills`
- React front end for:
  - live feed polling and freshness state
  - article mode with URL loading
  - typed article follow-up questions
  - push-to-talk voice mode routed through app orchestration
  - 1 / 2 / 3-anchor selection
  - story switching
  - prompt-driven orchestration
  - sequential panel playback
  - story packet inspection
- Express API for:
  - strict live feed adapter endpoint that validates upstream packets into local `StoryPacket` data
  - article fetching and readable-text extraction
  - article-grounded neutral responses
  - session prewarming and lazy start behavior
  - story packet selection
  - transcript-driven cross-anchor replies
  - browser-to-server FULL-mode session event relay

## Architecture

- `src/`
  - Viewer UI
- `server/`
  - Session manager
  - Mock LiveAvatar provider
  - Live feed adapter
  - Panel orchestrator
  - Story packet data
- `shared/`
  - Shared models for client and server

## LiveAvatar Boundary

This app supports two provider paths:

- `full-api`: backend creates real LiveAvatar FULL-mode session tokens
- `mock`: backend returns simulated sessions for offline development

For live-feed turn generation, the app also supports two backend LLM providers:

- `OpenAI`
- `Gemini`

The backend/session split follows the LiveAvatar FULL-mode constraints:

- API key stays backend-only
- each anchor has a stable runtime profile, plus dynamic article contexts when needed
- each anchor is treated as its own FULL-mode session config
- the UI never receives or stores a provider secret

When `LIVEAVATAR_MODE=full-api` and at least one LiveAvatar API key is set, the backend will:

- resolve or create one context per anchor
- provision sandbox sessions by default
- resolve fallback English voices per anchor unless explicit voice IDs are configured
- return session access tokens to the browser so the official Web SDK can start the avatar sessions

Per-anchor credentials are optional and override the global fallback:

- `LIVEAVATAR_NEUTRAL_API_KEY`
- `LIVEAVATAR_LEFT_API_KEY`
- `LIVEAVATAR_RIGHT_API_KEY`

## Development

```bash
npm install
npm run dev
```

This starts:

- frontend on `http://localhost:5173`
- backend on `http://localhost:4175`

## Localhost Runtime

The packaged runtime is localhost-only:

```bash
npm run pm2:start
```

Open:

- `http://127.0.0.1:4175`

One-off foreground run:

```bash
npm run start
```

## Verification

```bash
npm test
npm run build
```

## Environment

Create `.env.local` for real LiveAvatar sessions:

```bash
HOST=127.0.0.1
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
LIVEAVATAR_API_KEY=...
LIVEAVATAR_NEUTRAL_API_KEY=
LIVEAVATAR_LEFT_API_KEY=
LIVEAVATAR_RIGHT_API_KEY=
LIVEAVATAR_MODE=full-api
LIVEAVATAR_SANDBOX=true
LIVEAVATAR_SANDBOX_AVATAR_ID=dd73ea75-1218-4ef3-92ce-606d5f7fbc0a
LIVEAVATAR_NEUTRAL_AVATAR_ID=
LIVEAVATAR_NEUTRAL_VOICE_ID=
LIVEAVATAR_NEUTRAL_CONTEXT_ID=
LIVEAVATAR_NEUTRAL_CONTEXT_NAME=
LIVEAVATAR_LEFT_AVATAR_ID=
LIVEAVATAR_LEFT_VOICE_ID=
LIVEAVATAR_LEFT_CONTEXT_ID=
LIVEAVATAR_LEFT_CONTEXT_NAME=
LIVEAVATAR_RIGHT_AVATAR_ID=
LIVEAVATAR_RIGHT_VOICE_ID=
LIVEAVATAR_RIGHT_CONTEXT_ID=
LIVEAVATAR_RIGHT_CONTEXT_NAME=
PORT=4175
```

Optional live source configuration for `live_feed` mode:

```bash
LIVE_SOURCE_API_URL=https://your-backend.example.com
LIVE_SOURCE_CURRENT_PATH=/api/live/current
LIVE_SOURCE_API_KEY=...
LIVE_SOURCE_POLL_MS=5000
```

Live-feed anchor wording is generated on the local server from the current `StoryPacket`.

Expected live-source wire contract:

```json
{
  "contractVersion": "live_source_v1",
  "storyPacket": {
    "story_id": "string",
    "title": "string",
    "sourceUpdatedAt": "ISO-8601 string",
    "event_time_window": "string",
    "topic": "string",
    "keywords_spiking": ["string"],
    "neutral_summary": "string",
    "left_framing_summary": "string",
    "right_framing_summary": "string",
    "consensus_points": ["string"],
    "divergence_points": ["string"],
    "sentiment_by_cluster": {
      "neutral": "string",
      "left": "string",
      "right": "string"
    },
    "ad_safety_state": "safe | caution | unsafe",
    "confidence": 0.82,
    "source_evidence": [
      {
        "channel": "string",
        "lean": "neutral | left | right",
        "timestamp": "ISO-8601 string",
        "note": "string"
      }
    ]
  }
}
```

- `LLM_PROVIDER=openai` uses `OPENAI_API_KEY`
- `LLM_PROVIDER=gemini` uses `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- if the configured provider is unavailable or fails, the app falls back to deterministic template wording for the live panel

Optional per-anchor overrides:

- `LIVEAVATAR_NEUTRAL_AVATAR_ID`
- `LIVEAVATAR_NEUTRAL_VOICE_ID`
- `LIVEAVATAR_NEUTRAL_CONTEXT_ID`
- `LIVEAVATAR_NEUTRAL_CONTEXT_NAME`
- `LIVEAVATAR_LEFT_AVATAR_ID`
- `LIVEAVATAR_LEFT_VOICE_ID`
- `LIVEAVATAR_LEFT_CONTEXT_ID`
- `LIVEAVATAR_LEFT_CONTEXT_NAME`
- `LIVEAVATAR_RIGHT_AVATAR_ID`
- `LIVEAVATAR_RIGHT_VOICE_ID`
- `LIVEAVATAR_RIGHT_CONTEXT_ID`
- `LIVEAVATAR_RIGHT_CONTEXT_NAME`

## Notes

- Neutral Desk is prewarmed by default.
- Live feed mode polls the local Express backend only while `live_feed` is selected.
- The local Express backend validates your upstream live intelligence API against `live_source_v1` and caches only the last successful validated packet in memory.
- `live_feed` wording is model-generated on the local server when an LLM provider is configured, with per-turn cited evidence shown in the transcript panel.
- Article mode defaults to Neutral Desk only, but selected presenters can now debate the same loaded article while staying grounded to one shared source.
- Demo mode preserves the multi-anchor election desk with transcript-driven cross-anchor replies.
- In `full-api` mode, presenter selection only defines the roster; it does not start multiple LiveAvatar sessions.
- `Start stage` prepares only the current starter, and each later handoff activates the next presenter one at a time.
- Non-active selected presenters stay visible as `standby` cards instead of opening their own live sessions.
- Only one anchor owns a real LiveAvatar session at a time in v1, even if multiple presenter API keys are configured.
- Tone and opening-speaker controls live in the top setup drawer; `Interrupt turn` only appears while a round is active.
- Cross-anchor exchange is transcript-driven and limited to one pass through the selected anchor order.
- In `full-api` mode, the browser uses `@heygen/liveavatar-web-sdk` to attach real avatar sessions and speak orchestrated turns.
- In `full-api` mode, session status is driven by relayed real browser events instead of synthetic backend events.
- Voice mode is push-to-talk and routes transcripts back through the app backend for `article` and `live_feed` modes.
- The backend binds to `127.0.0.1` by default and serves the built frontend itself, so the PM2 runtime only needs one localhost process.

## PM2

Use the packaged PM2 commands:

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```
