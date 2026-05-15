# LiveAvatar Election Desk

> **Three perspectives. One screen.** A real-time AI news studio that puts left, right, and neutral analysis on the same story — with live fact-checking and broadcast-quality highlight reels. Built on **LiveAvatar** (FULL mode).

![liveavatar](https://img.shields.io/badge/LiveAvatar-FULL-7C5CFC) ![status](https://img.shields.io/badge/status-prototype-blue)

## Why

Tuning into Fox News, MSNBC, or a late-night show on the same headline can feel like watching three different countries. That fragmentation traps audiences in echo chambers — only ever hearing the version of a story that flatters their priors. Election Desk puts every side on one screen, debating each other in real time, with citations.

## What it does

Drop in any news article URL — or pick a demo story, or pull from a live feed. Three AI-powered anchors debate it on camera in real time:

- **Avery Quinn** — neutral moderator
- **Maya Reyes** — left analyst
- **Cole Brennan** — right analyst

While they speak, **Gemini fact-checks every claim** against the source article and Google Search. Newsroom graphics — lower-thirds, breaking bar, ticker, pull quotes — auto-generate from the debate as it unfolds. When the debate is over, one click renders a **broadcast-quality MP4 highlight reel** with chyrons and ticker baked in.

## Highlights

- **Multi-anchor debate orchestration** — an LLM picks who speaks next based on who was challenged and who's been quiet. Anchors can't paraphrase each other; the desk wraps gracefully when a topic exhausts.
- **Live fact-check pipeline** — Gemini + Google Search verifies 1–3 claims per turn in parallel with TTS. The next anchor sees the verdicts and builds on them.
- **Dynamic HUD** — broadcast graphics that re-render every round to reflect what was actually said.
- **WebGL chroma-key** — a custom GLSL shader composites avatars over a newsroom background in the browser.
- **One-click highlight reel** — per-turn WebM capture in the browser, scored and composed server-side via Hyperframes.
- **HeyGen avatar gallery** — browse hundreds of avatars, hear them speak, assign to any anchor.
- **Three story sources** — demo packets, paste-any-URL article mode, or live news feed.
- **Mock LiveAvatar provider** — full feature parity for offline dev.

See [docs/PROJECT.md](docs/PROJECT.md) for the deep dive.

## Quickstart

```bash
# Install
npm install
(cd hyperframes && npm install)

# Configure
cp .env.example .env
# Fill in:
#   LIVEAVATAR_API_KEY=...
#   OPENAI_API_KEY=...
#   GEMINI_API_KEY=...

# Run
npm run dev

# App at http://localhost:5173
# API at http://localhost:4175
```

For a no-key offline run, set `LIVEAVATAR_PROVIDER=mock` — the desk works end-to-end without any external services.

## Demo Script

The **2-minute demo script** with storyboard cues lives at [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).
The **detailed scene-by-scene visual script** (paste-into-Claude format for design) is at [docs/VISUAL_SCRIPT.md](docs/VISUAL_SCRIPT.md).
The **spoken pitch + Q&A prep** is at [docs/PITCH.md](docs/PITCH.md).

## Architecture

```
┌────────────┐   WebRTC    ┌──────────────────┐
│  Browser   │◀───────────▶│    LiveAvatar    │
│  React UI  │             │   (3 sessions)   │
└─────┬──────┘             └──────────────────┘
      │ NDJSON
      ▼
┌────────────────────────────────────────────┐
│ Server (Express)                           │
│  Orchestrator → LLM (OpenAI) → speak()     │
│  Fact-check (Gemini+Search) ─┐             │
│  HUD context (Gemini)        │ in parallel │
│  Highlight reel (Hyperframes)┘             │
└────────────────────────────────────────────┘
```

Full diagram and breakdown in [docs/PROJECT.md](docs/PROJECT.md).

## Tech

- **Frontend** — React 19, Vite 6, Framer Motion, custom WebGL shader
- **Backend** — Express, tsx, Zod, NDJSON streaming
- **Avatars** — LiveAvatar FULL mode (LiveKit-based WebRTC)
- **LLM (debate)** — OpenAI `gpt-5.4-mini` with strict JSON-schema outputs
- **LLM (fact-check + HUD)** — Gemini with native Google Search grounding
- **Reel composition** — Hyperframes (HTML + GSAP templates rendered to MP4)
- **Tests** — Vitest + jsdom + Testing Library

## Roadmap

- **Morning briefing.** Subscribe to topics; the desk delivers a 3-minute multi-perspective digest each morning.
- **RSS / multi-feed ingestion.** Point at any RSS bundle across the spectrum and get a debate per story.
- **Instant highlights from long-form events.** Drop in a 2-hour rally, debate, or hearing — agents extract the moments worth sharing.
- **Embed widget.** Drop-in panel for any news site to add a 3-perspective debate beside the article.
- **Producer dashboard.** Newsroom tool for spinning up explainer segments and exporting reels for social.

## Project Status

Prototype. State is in-memory; there's no auth; three anchors are wired in but the system is parameterized for more. See [docs/PROJECT.md](docs/PROJECT.md#known-limits) for the punch list.

The previous README (with implementation-status notes) is preserved at [README.legacy.md](README.legacy.md).

## Credits

Built on **LiveAvatar** — the real-time avatar streaming API that makes this whole thing possible.
