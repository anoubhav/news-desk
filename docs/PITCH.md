# Pitch & Q&A Cheat-Sheet

## The 90-second spoken pitch

> "When I switch from Fox to MSNBC to a late-night show, the same story can sound like three completely different stories. We're stuck in echo chambers. So I built **LiveAvatar Election Desk** — three AI anchors on one screen: a left-leaning analyst, a right-leaning analyst, and a neutral moderator.
>
> You drop in any article URL — or pull from an RSS feed, or a live news feed. The desk reads it, generates left and right framings, and the panel debates it on camera. The avatars are powered by **LiveAvatar in FULL mode** — real WebRTC video, sub-second response time, separate sessions per anchor.
>
> The trick that makes it feel alive: an LLM watches the transcript and **decides who speaks next** based on who was challenged, who's been quiet, and what hasn't been said. Anchors can't repeat each other — there's a paraphrase guard in the prompt. If a topic exhausts itself, the desk wraps gracefully instead of forcing rounds.
>
> While anchors speak, **Gemini fact-checks every claim** against Google Search and the source article in parallel. Verdicts and sources show up under each turn before the next anchor starts. The next speaker sees the fact-checks and builds on them.
>
> The newsroom HUD — breaking bar, ticker, lower-thirds, pull quotes — all regenerate from the debate as it unfolds. And when you're done, **one button renders a broadcast-quality highlight reel** to MP4 using Hyperframes.
>
> Where this goes next: a **morning briefing** delivered every day from three perspectives, and **instant highlights from two-hour political rallies** — the moments worth sharing, surfaced automatically. It's a full-stack proof that LiveAvatar can power editorial-grade live formats — not just chatbots with a face."

**Time it.** If it runs over, cut the future-work paragraph first, then the highlight reel paragraph.

## 30-second elevator version

> "News today fragments by network — Fox, MSNBC, late-night — so audiences live in echo chambers. I built **LiveAvatar Election Desk**: three AI anchors on one screen — left, right, and neutral — that debate any article, RSS feed, or live story in real time, with Gemini fact-checking every claim against Google Search. Built on LiveAvatar. Next: morning briefings and instant highlights from two-hour rallies."

## One-liners

- "News fragmentation creates echo chambers. I built three AI anchors — left, right, neutral — that debate any story on one screen, with live fact-checking."
- "Three AI anchors — left, right, neutral — debate any news story in real time, with live fact-checking and a one-click highlight reel."
- "LiveAvatar plus orchestrated debate plus Gemini fact-check plus Hyperframes reel. Editorial-grade news desk in one screen."
- "Paste a URL. Three avatars argue about it. Gemini fact-checks them. Press a button, get a broadcast clip."

## The "why this matters" beats

1. **The news ecosystem is fragmented.** Fox, MSNBC, and late-night make the same headline sound like three completely different stories. Audiences live in echo chambers because there's no single surface that puts every side together. Election Desk *is* that surface.
2. **News today is built for one side at a time.** This shows the same story from three angles, simultaneously, on camera.
3. **Avatars usually monologue.** This one orchestrates a debate where anchors actually respond to each other, with a paraphrase guard to keep the substance moving.
4. **Hallucination is the elephant.** Real-time fact-check with cited sources turns the desk from "AI talking heads" into "AI talking heads with a fact-checker on staff."
5. **Editorial workflows need outputs, not just streams.** The one-click highlight reel turns ephemeral debate into a shareable broadcast clip.
6. **This generalizes beyond a single article.** The same pipeline takes any RSS feed (morning briefing) or any long-form event (rally, debate, hearing) and produces shareable, multi-perspective output.

---

## Likely Q&A

### Product / Vision

**Q: What's the problem you're actually solving?**
> The news ecosystem is fragmented. The same story on Fox, MSNBC, and late-night reads like three different events. People only watch the network that flatters their priors, which deepens echo chambers. Election Desk is a single surface where you hear every side, with citations, on the same screen.

**Q: Who's the user?**
> Three audiences. (1) **Newsroom producers** prototyping multi-perspective formats. (2) **Civic-tech orgs and education platforms** teaching media literacy. (3) **Individual readers** who don't have time to triangulate three networks themselves. Long-term, the morning-briefing surface targets the third group directly.

**Q: Why three anchors and not more?**
> The orchestrator is parameterized — anchors are a list, not three hardcoded slots. The UI assumes left/right/neutral lenses for the political-debate framing, but the underlying system supports any persona set (think economist / civil-rights advocate / national-security analyst on a tech-policy story).

**Q: Isn't this just a chatbot with a face?**
> Three differences. First, multi-agent — anchors talk to each other, not to you. Second, the LLM picks turn order based on what was just said, with a paraphrase guard. Third, real-time fact-check feeds back into the next turn. It's an editorial workflow, not a chat.

**Q: How is this different from HeyGen Interactive Avatar?**
> LiveAvatar is the underlying tech — but I'm using FULL mode with three concurrent sessions, per-anchor contexts and voices, and orchestration on top. Interactive Avatar is a 1:1 chat surface; this is a multi-anchor production studio.

**Q: Where does this go next?**
> Three product surfaces. **Morning briefing** — subscribe to topics, get a 3-minute multi-perspective digest every morning. **RSS / multi-feed ingestion** — point at any feed bundle across the spectrum, get a debate per story. **Instant highlights from long-form events** — drop in a 2-hour political rally or hearing, agents extract the moments worth sharing.

### Technical

**Q: How do you handle three avatars without latency exploding?**
> Each anchor has its own LiveAvatar session, prewarmed at bootstrap. Speech is sequential (one anchor at a time, like real TV), but fact-check and HUD generation run **in parallel** with TTS so the next prompt is ready the moment the current speaker finishes.

**Q: How do you stop them from repeating each other?**
> Three guards. (1) Self-exclusion windowing — each anchor sees peer turns but not their own. (2) A paraphrase test in the prompt: if your reply compresses to the same core claim as any prior turn, you must yield. (3) Topic-exhaustion detection: if ≥50% yield, the desk wraps with a moderator beat instead of forcing rounds.

**Q: How does the speaker bidding actually work?**
> Round 1 is shuffled within constraints (fixed opener if set). Round 2+ calls an LLM with the recent transcript and current speaker stats, returning a ranked order. Falls back to deterministic rotation if the call fails.

**Q: Fact-check — is it real?**
> Yes. Gemini with **native Google Search grounding**. For article-mode stories, claims are first checked against the source article text; uncovered claims fall back to web search. Verdicts come with outlets and snippet citations from Gemini's grounding metadata.

**Q: Could the fact-checker hallucinate too?**
> It can — that's why every verdict shows the source URL it pulled. The UI surfaces the source, not just the verdict. Confidence is also exposed per turn so you can see when the model is uncertain.

**Q: Why OpenAI for debate but Gemini for fact-check?**
> OpenAI's structured-outputs schema enforcement is rock-solid for the debate-turn JSON contract. Gemini's native Google Search tool removes a hop for fact-check — no separate retrieval pipeline.

**Q: WebRTC — what's the transport?**
> LiveAvatar's SDK uses LiveKit under the hood. We grab the remote audio and video MediaStreamTracks, attach to `<video>` elements, and (for highlight clips) capture them with MediaRecorder.

**Q: How does the highlight reel get built?**
> Per-turn capture in the browser via MediaRecorder (VP9/Opus, VP8 fallback). Each clip POSTs to the server as the turn ends. On render, we score each turn — citation boost × divergence-keyword hits × length factor — pick the top N, restore narrative order, build a Hyperframes manifest, and shell out to `npx hyperframes render`. MP4 in seconds.

**Q: What's Hyperframes?**
> A composition framework that renders HTML/CSS/GSAP scenes to MP4. Lets us treat broadcast graphics as web components — no After Effects rebuild cycle. The compositions live in `hyperframes/players/`.

**Q: Chroma-key — why client-side?**
> Backend chroma-keying would mean piping every video frame through a server, killing latency. The WebGL fragment shader runs on the user's GPU at zero added cost. YCbCr-distance for chroma matching, with green-spill suppression for clean edges.

**Q: What if LiveAvatar is down or rate-limited?**
> The provider abstraction has a mock mode with full feature parity — sessions, events, transcript, everything except actual video. Useful for tests and offline demos. Token creation also has exponential backoff on 409/429.

**Q: Storage / state?**
> In-memory only. Prototype — reload loses transcripts. Adding a persistence layer is on the punch list.

**Q: Tests?**
> Vitest + jsdom + Testing Library. Coverage on orchestrator, LLM providers, article extraction, fact-check builder, session manager.

### Business / Differentiation

**Q: What's the moat?**
> The orchestration layer — paraphrase guard, speaker bidding, fact-check feedback loop. That's the editorial IP. Avatars and LLMs are commodities; the *flow* between them is the product.

**Q: How would you ship this?**
> Three obvious surfaces. (1) Embed widget for news sites — drop-in panel beside any article. (2) Producer tool — newsroom dashboard for staff to spin up explainer segments. (3) API — POST a story, get back a debate transcript + reel.

**Q: Bias — these personas could go off the rails.**
> Two safeguards in the prompt layer. (1) Each anchor must acknowledge the strongest opposing point before pushing back. (2) Ad-safety state from the story packet gates language — unsafe stories trigger constrained framing. Plus the fact-check is the structural backstop: false claims get flagged in real time.

---

## Things to NOT promise on stage

- "It can do any language." — Currently English voice fallbacks only.
- "Real-time live news feed." — The adapter exists but needs an upstream API config.
- "Production-ready." — It's a prototype with in-memory state.
- "100 anchors." — System is parameterized but the UI assumes the 3-lens framing.

---

## If the demo crashes

1. Switch to **mock provider** — full feature parity, no network.
2. Use a **pre-loaded demo story** instead of pasting a URL.
3. Show the **highlight reel from a previous run** — they're saved to disk.
4. Pull up [PROJECT.md](PROJECT.md) and walk the architecture diagram.
5. Worst case: read the spoken pitch from this file. The story holds without the demo.
