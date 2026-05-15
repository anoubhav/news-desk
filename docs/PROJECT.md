# LiveAvatar Election Desk — Project Documentation

## Why this exists

The news ecosystem is fragmented along ideological lines. Tuning into Fox News, MSNBC, or a late-night show on the same story produces three almost-unrecognizable accounts — and audiences end up in echo chambers, only ever hearing the version that flatters their priors.

**LiveAvatar Election Desk** puts those perspectives back on one screen. Three AI-powered anchors — a left-leaning analyst, a right-leaning analyst, and a neutral moderator — debate the same story in real time, with live fact-checking against the source article and Google Search. You hear every side, with citations, in one sitting.

## What it is

A real-time, multi-perspective news studio. Stories come from demo packets, any pasted article URL, or a live news feed. The anchors stream over WebRTC, take turns based on an LLM-driven speaker bidding system, and every claim is fact-checked in parallel. Each debate can be exported as a broadcast-quality MP4 highlight reel.

The project is built on top of **LiveAvatar** (FULL mode), demonstrating that LiveAvatar can power editorial-grade live formats, not just one-on-one chat.

## The User Flow

1. **Open the app.** The desk boots, syncs anchor sessions, and loads stories.
2. **Pick a source.** Demo story, paste an article URL, or live feed.
3. **Pick anchors.** Toggle any combination of neutral / left / right (1–3).
4. **Ask a question.** Type or speak — voice capture is built in.
5. **Watch the debate.** Anchors stream over WebRTC, each one responding to the last. HUD overlays update per round.
6. **See fact-checks.** Each claim is verified against the source article and Google Search; verdicts surface under each turn.
7. **Render the reel.** One click composes a 30–90s broadcast-quality MP4 from the recorded turns.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                       BROWSER (React)                       │
│                                                             │
│  Control / Composer / Story Inspector                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Avatar L │  │ Avatar M │  │ Avatar R │  + Newsroom HUD   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                   │
│       │ WebRTC       │ WebRTC      │ WebRTC                 │
└───────┼──────────────┼─────────────┼─────────────────────────┘
        │              │             │
        ▼              ▼             ▼
   ┌──────────────────────────────────────┐
   │        LiveAvatar (FULL mode)        │
   │  separate session per anchor         │
   └──────────────────────────────────────┘
              ▲
              │  speak(text)
              │
┌─────────────┴────────────────────────────────────────────────┐
│                     SERVER (Node + tsx)                      │
│                                                              │
│  ┌──────────────────┐   ┌────────────────────┐               │
│  │  Article / Feed  │──▶│   Orchestrator     │               │
│  │  Source Adapters │   │  routing + bidding │               │
│  └──────────────────┘   └─────┬──────────────┘               │
│                               │                              │
│  ┌──────────────────┐   ┌─────▼──────────────┐               │
│  │  LLM Providers   │◀──│  Turn Builder      │               │
│  │  OpenAI / Gemini │   │  (per anchor)      │               │
│  └──────────────────┘   └─────┬──────────────┘               │
│                               │                              │
│  ┌──────────────────┐   ┌─────▼──────────────┐  ┌─────────┐  │
│  │  Fact-Check      │◀──│  Session Manager   │─▶│ HUD     │  │
│  │  (Gemini+Search) │   │                    │  │ Context │  │
│  └──────────────────┘   └─────┬──────────────┘  └─────────┘  │
│                               │                              │
│                         ┌─────▼──────────────┐               │
│                         │ Highlight Reel     │               │
│                         │ (Hyperframes CLI)  │               │
│                         └────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

## Repo Layout

```
live_avatar/
├── src/                          Frontend (React + Vite)
│   ├── App.tsx                   App state machine
│   ├── components/               UI surface (10 components + hud/)
│   └── lib/
│       ├── api.ts                HTTP + NDJSON streaming client
│       ├── liveavatar.ts         LiveAvatar SDK wrapper
│       ├── chromakey.ts          WebGL green-screen shader
│       ├── highlightRecorder.ts  Per-turn WebM capture
│       ├── hudBus.ts             Pub/sub event bus for HUD
│       └── hyperframesPlayer.tsx Inline reel player
├── server/                       Backend (Express + TypeScript)
│   ├── index.ts                  HTTP server, ~30 endpoints
│   ├── data/
│   │   ├── anchors.ts            Three anchor personas
│   │   └── stories.ts            Demo story packets
│   ├── services/
│   │   ├── orchestrator.ts       Turn-taking + debate flow
│   │   ├── orchestrator/         Bidding helpers
│   │   ├── liveResponse/         LLM provider abstraction
│   │   ├── liveavatar/           LiveAvatar provider (mock + full-API)
│   │   ├── articleSource.ts      Readability article extraction
│   │   ├── factCheck/            Gemini + Google Search fact-check
│   │   ├── highlightReel/        Manifest builder + Hyperframes renderer
│   │   └── hudContext/           LLM-generated HUD copy (ticker, breaking)
│   └── state/sessionManager.ts   LiveAvatar session lifecycle per anchor
├── shared/models.ts              50+ TS interfaces (frontend ↔ backend)
├── hyperframes/                  Hyperframes compositions (HTML+GSAP)
└── package.json                  Monorepo scripts
```

## The Three Anchors

| Anchor | Lens | Mandate (enforced in system prompt) |
|--------|------|-------------------------------------|
| **Avery Quinn** | Neutral moderator | Name what's known, contested, uncertain. Close on the next concrete signal to watch. |
| **Maya Reyes** | Left analyst | Surface a structural factor (policy, institution, access) the others didn't. Acknowledge the strongest right-side point first. |
| **Cole Brennan** | Right analyst | Surface an incentive or accountability angle the others didn't. Acknowledge the strongest left-side point first. |

Each has its own LiveAvatar context, fallback voice list, and accent color.

## Headline Features

### 1. LiveAvatar FULL-mode integration
- Three concurrent sessions, one per anchor, each with its own context and voice
- Per-anchor API key support for isolation
- Concurrency-safe session token creation with exponential backoff
- Sandbox flag respected for unverified avatars
- Browser SDK wraps LiveKit transport; voice capture (push-to-talk) supported

### 2. Multi-anchor debate orchestration
- Viewer prompts routed to response goals (`compare`, `left_view`, `anchor_reply`, `debate`, etc.)
- LLM-driven speaker bidding from round 2 onward — picks who should rebut whom
- Self-exclusion windowing: anchors see peer turns but not their own (prevents echo chambers)
- Paraphrase guard: if a turn would compress to the same core claim as a prior turn, the anchor must yield
- Topic-exhaustion detection: if ≥50% of anchors yield, the desk wraps gracefully
- Moderator beats from Avery between rounds when neutral is selected

### 3. Real-time fact-checking (Gemini + Google Search)
- Runs in parallel with avatar speech — zero added latency
- Article-grounded first, falls back to live web search
- 1–3 claims per turn extracted, verdicts: verified / disputed / unverified / opinion
- Sources cited with outlet and snippet
- Confidence score 0–100 per turn
- Skips yield turns (handoff sentences aren't fact-claims)
- Next anchor's prompt **includes** prior fact-checks so rebuttals stand on solid ground

### 4. Multi-source story ingestion
- **Demo mode:** pre-built story packets with full framings
- **Article mode:** paste any URL → Mozilla Readability extracts text → snippets, keywords, neutral summary, left/right framings, ad-safety state, confidence score
- **Live feed mode:** polls upstream intelligence API; Zod-validated `StoryPacket` contract

### 5. Dynamic newsroom HUD
- Event-driven pub/sub bus (`hudBus.ts`) decouples state from graphics
- Lower-third name plates per anchor with accent colors
- Breaking bar with kicker (BREAKING / DEVELOPING / LIVE UPDATE)
- Scrolling ticker with crawling animation
- Pull-quote graphics
- HUD copy regenerated by Gemini after every round, reflecting what was actually said

### 6. WebGL chroma-key compositing
- Custom GLSL fragment shader, YCbCr distance for chroma-only matching
- Spill suppression on subject edges
- Configurable threshold / smoothness / spill-suppress per anchor
- Runs every frame on the avatar video element — broadcast studio look without backend processing

### 7. Highlight reel rendering (Hyperframes)
- Per-turn WebM recording in the browser (VP9/Opus or VP8 fallback)
- Auto-uploaded to server as turns finish
- Server scores turns: `citationBoost × (divergenceKeywordHits + 1) × lengthFactor`
- Picks top N, restores narrative order, builds Hyperframes manifest
- Spawns `npx hyperframes render`, returns MP4 in seconds
- Composition templates: ticker, L3, breaking bar, OTS card, pull quote, consensus outro

### 8. HeyGen avatar gallery with auto-pick
- Browse, search, paginate hundreds of avatars
- Gender inferred from name lists for fair auto-assignment
- Live preview: spins up a short LiveAvatar session, plays a sample line, tears down cleanly
- Per-anchor overrides persisted in `localStorage` and server-side

### 9. Voice input
- Push-to-talk via LiveAvatar SDK microphone unmute
- Transcription streamed back, becomes the user's question

### 10. Mock provider for offline dev
- Full feature parity with real LiveAvatar (sessions, events, transcript) without billing or network
- Useful for offline demos and Vitest suites

## API Surface (selected)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/bootstrap` | GET | Anchors, sessions, stories, provider mode, live-feed status |
| `/api/mode/select` | POST | Switch source mode |
| `/api/articles/load` | POST | Load article URL → `StoryPacket` |
| `/api/orchestrate` | POST | Stream debate turns as NDJSON |
| `/api/sessions/events` | POST | Relay browser SDK events back to server |
| `/api/highlights/clip/:sessionId/:turnId` | POST | Upload per-turn WebM clip |
| `/api/highlights/render` | POST | Render highlight reel MP4 |
| `/api/avatars/gallery` | GET | List HeyGen avatars + voices |
| `/api/avatars/preview/token` | POST | Short-lived token for in-gallery preview |
| `/api/hud/context` | POST | Generate HUD copy for current state |

## Configuration

Set in `.env` (see `server/config.ts` for full list):

```
LIVEAVATAR_API_KEY=...
LIVEAVATAR_NEUTRAL_API_KEY=...      # optional per-anchor isolation
LIVEAVATAR_LEFT_API_KEY=...
LIVEAVATAR_RIGHT_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...                   # required for fact-check + HUD copy
LIVE_FEED_URL=...                    # optional live news feed
PORT=4175
```

## Tech Choices

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React 19 + Vite 6 + Framer Motion | Fast HMR, smooth motion |
| Backend | Express + tsx + Zod | Zero-build dev loop, runtime contract safety |
| LLM (debate) | OpenAI (`gpt-5.4-mini` default) with Gemini fallback | Strict JSON-schema outputs |
| LLM (fact-check + HUD) | Gemini with native Google Search grounding | Built-in source citations |
| Avatar | LiveAvatar FULL mode | Per-anchor contexts, real-time WebRTC |
| Streaming | NDJSON over fetch | Works anywhere, no extra deps |
| Reel | Hyperframes (HTML + GSAP compositions) | Edit graphics without rebuild |
| Tests | Vitest + jsdom + RTL | Fast, ESM-native |

## Roadmap / What's Next

**Near-term (the obvious next steps):**
- Persistent session state — currently in-memory; reload loses transcripts
- Configurable persona sets (not just left/right/neutral — e.g., economist / civil-rights advocate / national-security analyst)
- Auth + multi-tenant
- Live-feed adapter wired to a specific upstream (the abstraction is in place)
- LLM-driven highlight-reel scoring (current scorer is heuristic)

**Bigger product surfaces:**
- **Morning briefing.** Subscribe to topics; every morning the desk delivers a 3-minute multi-perspective digest of overnight stories, generated automatically.
- **RSS / multi-feed ingestion.** Point the desk at any RSS bundle (your favorite outlets across the spectrum) and it produces a debate per story.
- **Instant highlights from long-form events.** Drop in a 2-hour political rally, debate, or hearing — agents scrub the transcript, extract the moments worth sharing, and produce shareable clips automatically.
- **Embed widget.** A drop-in panel for any news site to add a 3-perspective debate beside the article.
- **Producer dashboard.** Newsroom-facing tool for staff to spin up explainer segments and export reels for social.

## Known Limits

- In-memory session state — reload loses transcripts (intentional for prototype scope)
- Three anchors hardcoded in the UI; the personas system is parameterized but the layout assumes 3 lenses
- No auth (localhost prototype)
- Live-feed adapter is generic — needs configuration for a specific upstream
- Reel scoring is heuristic
- English voice fallbacks only
