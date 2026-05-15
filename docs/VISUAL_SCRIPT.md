# LiveAvatar Election Desk — Detailed Visual Script

> **For:** pasting into Claude (or any design / animatic / motion-graphics tool) to generate concept frames, storyboards, or a short animatic.
> **Format:** every scene has VOICEOVER, ON-SCREEN ACTION, VISUAL DIRECTION (color / motion / typography), TRANSITION OUT.
> **Total runtime:** ~2:05.
> **Aspect:** 16:9, 1920×1080. Designed to also crop to 9:16 vertical (avatar-tile crops cleanly).
> **Palette:** dark slate background `#0B0F1A`, gold accent `#F2C94C`, left-red `#E54B4B`, right-blue `#4B7BE5`, neutral-gold `#F2C94C`, ticker green `#3DDC97`. Typography: **Aurora Display** for chyrons (faux-broadcast), **Inter** for UI.

For the spoken script (no visual direction) see [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

---

## SCENE 1 — Cold Open: "Three different countries" (00:00 – 00:15)

**VOICEOVER (you):**
> "When I switch from Fox to MSNBC to a late-night show, the same story can feel like three different countries. We're stuck in echo chambers."

**ON-SCREEN ACTION:**
- **0:00** — Black frame. Faint TV-static audio bed.
- **0:01** — Frame splits into three vertical panels left-to-right. Each panel shows a stylized cable-news mockup — same headline ("BIG VOTE TONIGHT") but three different framings:
  - Left panel: deep-red lower third, aggressive font, headline reads **"DEMOCRACY ON THE BRINK"**
  - Center panel: yellow late-night card, mocking caption **"THIS IS FINE"** (only emoji-style sticker allowed in this scene; show on stage TV mock — *not* in our app UI)
  - Right panel: deep-blue lower third, sober font, headline reads **"VOTERS DEMAND RESULTS"**
- **0:06** — Audio swells with overlapping anchor voices (incoherent crowd of opinions).
- **0:10** — Audio cuts to silence. White text fades in centered: **"ECHO CHAMBERS."** (Aurora Display, 96pt, letter-spaced 0.1em).
- **0:13** — Text dissolves into particles that blow toward center.

**VISUAL DIRECTION:**
- Each side panel uses an exaggerated network-style chyron — viewers should instantly "read" it as cable news without us imitating any specific brand.
- Red, yellow, blue panels have *vibrating* color saturation (subtle Gaussian shake, ±2% saturation) to convey noise/agitation.
- Audio mix: build from one voice → six voices in 6 seconds → silence. The drop is the punch.

**TRANSITION OUT:** Particles converge to a single point of light at center, holding for 0.3s.

---

## SCENE 2 — The Fix: App reveal (00:15 – 00:30)

**VOICEOVER:**
> "So I built the **LiveAvatar Election Desk** — three AI anchors, one story, every perspective on screen at once."

**ON-SCREEN ACTION:**
- **0:15** — The point of light expands into the app frame. The dark slate background `#0B0F1A` fills the screen with a subtle aurora gradient (deep-purple → indigo → black, slowly drifting).
- **0:17** — UI assembles in this order, each element fading + sliding 12px:
  1. Top breaking bar — pulsing red strip with kicker **"BREAKING"** in white, story title scrolling right-to-left
  2. Three avatar tiles in a row, lit one by one with a soft "TV-on" flicker (Maya left-red border, Avery center-gold, Cole right-blue)
  3. Lower-third name plates animate up on each tile with a 0.1s stagger
  4. Ticker bar at bottom begins crawling
  5. Composer panel slides in from the right
- **0:25** — Camera does a slow 5% push-in toward the desk.

**VISUAL DIRECTION:**
- The "build" should feel like a control room going live — every element snapping in with purpose.
- Avatar tiles use a subtle vignette + gold rim-light to feel cinematic.
- Aurora background should be perceptible but not distracting (max 30% opacity over the slate).

**TRANSITION OUT:** Hold on the assembled desk for one beat (0:29).

---

## SCENE 3 — Entry Points: Source picker montage (00:30 – 00:50)

**VOICEOVER:**
> "Drop in any article URL. Or pull from an RSS feed. The desk extracts the story and generates left, right, and neutral framings — automatically."

**ON-SCREEN ACTION:**
- **0:30** — Cursor moves to the "Source" toggle in the Control Panel. Click. Three options expand: **DEMO STORY · ARTICLE URL · LIVE FEED**.
- **0:33** — Cursor selects ARTICLE URL. URL input field grows to focus. Text types in: `https://...election-coverage-2026...`
- **0:36** — Hit enter. A loading shimmer sweeps across the Story Inspector panel.
- **0:39** — Story Inspector populates with three blocks animating in sequentially (200ms apart):
  - **NEUTRAL SUMMARY** (gold pill)
  - **LEFT FRAMING** (red pill) — visibly different language
  - **RIGHT FRAMING** (blue pill) — visibly different language
- **0:43** — Quick cut: source toggle flips to LIVE FEED. A list of headlines streams in with timestamps.
- **0:47** — Quick cut back to ARTICLE mode with the loaded story ready.

**VISUAL DIRECTION:**
- The three framing pills should be visually parallel but with **clearly different word choices** highlighted in yellow underline — the visual point is "same story, different lenses."
- Loading shimmer should look like film-emulsion sweep, not a generic spinner.

**TRANSITION OUT:** Cut to Composer panel zoomed.

---

## SCENE 4 — The Debate: Anchors respond to each other (00:50 – 01:20)

**VOICEOVER (over avatar audio, ducked):**
> "Three avatars stream over WebRTC. An LLM picks who speaks next based on what was just said, so they actually respond to each other instead of monologuing. The newsroom graphics regenerate every round to reflect what was just argued."

**ON-SCREEN ACTION:**
- **0:50** — Cursor types in Composer: *"What's the strongest argument on each side?"* — hit send.
- **0:52** — All three avatar tiles dim slightly to "standby." A subtle "thinking" dot animation appears on each.
- **0:54** — **Maya (left)** lights up. Red-accent rim-light intensifies. Lower-third animates: **"MAYA REYES · LEFT"**. She speaks 5–6 seconds. Closed-caption subtitle appears below her tile in white.
- **1:01** — Mid-Maya, the **Ticker** updates: a new headline crawls in matching her point.
- **1:03** — Maya finishes. Tile dims. **Cole (right)** lights up — blue rim-light. His L3: **"COLE BRENNAN · RIGHT"**. He directly addresses Maya's point ("Maya is right that X, but…"). 5–6s.
- **1:11** — **Avery (center)** lights up — gold rim-light. L3: **"AVERY QUINN · MODERATOR"**. She summarizes the divergence point. 5s.
- **1:17** — Round complete. Breaking bar pulses with a new kicker: **"DEVELOPING"**. Ticker re-renders with three fresh headlines (one per anchor's point).

**VISUAL DIRECTION:**
- The "speaking" tile gets a **3px accent border + rim-light glow**; non-speaking tiles drop to 60% opacity and lose the glow. This is the single most important visual cue — viewer's eye follows the action.
- Lower-third name plates should **slide in from off-frame bottom** with a 0.15s ease-out + a quick light sweep across the text.
- Ticker text should be ALL CAPS, monospace, ~28pt, crawling at ~60px/sec.
- Closed captions should **only** appear under the active speaker.

**TRANSITION OUT:** Quick zoom to Cole's tile as fact-check card slides in below.

---

## SCENE 5 — Real-Time Fact-Check (01:20 – 01:40)

**VOICEOVER:**
> "Every claim is fact-checked live by Gemini against Google Search and the source article — in parallel with the speech, so there's no added latency. The next anchor sees the verdicts and builds on them."

**ON-SCREEN ACTION:**
- **1:20** — A **Fact-Check Card** slides up from beneath Cole's tile. Card header: **"FACT CHECK · COLE BRENNAN"** with a small Gemini sparkle icon.
- **1:23** — Three claim rows animate in with 0.2s stagger:
  - Row 1: Claim text → **VERIFIED** pill (green) → source URL chip ("apnews.com")
  - Row 2: Claim text → **DISPUTED** pill (red) → source URL chip ("reuters.com")
  - Row 3: Claim text → **OPINION** pill (gray) → no source
- **1:30** — Camera pushes in on the **DISPUTED** row. Source chip glows. A small "open-in-new" icon flashes.
- **1:34** — Camera pulls back. The next anchor (Avery) is already lighting up — visualize the parallelism by showing Avery's "thinking" dots animating *behind* the fact-check card while it's still rendering.

**VISUAL DIRECTION:**
- Verdict pills must be **color-coded and color-blind-safe** — pair color with an icon.
- The card should feel like a broadcast graphic, not a web modal — sharp corners, monospace label, subtle film-grain texture on the background.
- The push-in on DISPUTED is the emotional beat — let it breathe for 2s.

**TRANSITION OUT:** Card stays pinned; camera pulls back to wide of all three tiles.

---

## SCENE 6 — One-Click Highlight Reel (01:40 – 01:55)

**VOICEOVER:**
> "And one click renders a broadcast-quality highlight reel — every turn was captured in the browser, then composed server-side with Hyperframes."

**ON-SCREEN ACTION:**
- **1:40** — Cursor moves to the **HIGHLIGHT REEL** panel. Hovers a glowing button: **"RENDER REEL"**.
- **1:42** — Click. Button morphs into a thin progress bar that fills left-to-right with a soft gold glow, ~3 seconds.
- **1:45** — Progress bar transforms into a video player. The MP4 plays full-width:
  - Cut 1: Maya speaking with her L3 + ticker baked in
  - Cut 2: Cole rebutting with his L3
  - Cut 3: Avery wrapping with **CONSENSUS POINT** card overlay
  - Outro: brand sting with desk wide shot
- **1:53** — Reel pauses on the outro frame.

**VISUAL DIRECTION:**
- The render bar should feel **fast** — show the system working, but don't dwell. 3s max.
- The reel itself is the proof of concept — let the audio of the reel come up briefly so judges *hear* the broadcast feel.
- Use a subtle wipe transition between the three cuts (not hard cut) to feel produced.

**TRANSITION OUT:** Reel freezes; UI fades back up around it.

---

## SCENE 7 — Future + Tag (01:55 – 02:05)

**VOICEOVER:**
> "Next: morning briefings, instant highlights from two-hour rallies. **LiveAvatar Election Desk** — three perspectives, one screen. Built on LiveAvatar."

**ON-SCREEN ACTION:**
- **1:55** — Three quick mockup cards flash in sequence (1s each):
  1. **"YOUR MORNING BRIEFING — 6:30 AM"** card with three anchor thumbnails + a play button
  2. A 2-hour political rally video thumbnail with a **"SCRUBBING…"** progress bar, then 5 clip thumbnails popping out labeled **"INSTANT HIGHLIGHTS"**
  3. An RSS feed icon with three perspective-pills branching out
- **2:00** — Cards dissolve into the brand mark: **LIVEAVATAR ELECTION DESK** in Aurora Display, gold on slate, with the tagline below in Inter Light: *"Three perspectives. One screen."*
- **2:03** — Sub-line in small caps: **POWERED BY LIVEAVATAR**.

**VISUAL DIRECTION:**
- The future-work cards should feel *aspirational* — slightly more polished than the live UI, hinting at where the product goes.
- The brand mark hold should be at least 2 full seconds — let it land.

**TRANSITION OUT:** Slow fade to black.

---

## Visual Direction Summary (paste-friendly bundle for designer)

```
PROJECT: LiveAvatar Election Desk — 2-min demo

THESIS: News fragmentation creates echo chambers. We show three perspectives on
one screen, debating the same story in real time.

PALETTE:
  background     #0B0F1A
  accent gold    #F2C94C
  left red       #E54B4B
  right blue     #4B7BE5
  ticker green   #3DDC97
  text white     #F5F7FA
  text muted     #8B95A8

TYPE:
  display    Aurora Display (faux-broadcast chyron font)
  ui         Inter
  ticker     JetBrains Mono ALL CAPS

MOTION RULES:
  - tile activation = 3px accent border + rim-light glow + bring to 100% opacity
  - tile inactive   = 60% opacity, no border, no glow
  - L3 animations   = slide-in 0.15s ease-out + light sweep
  - HUD updates     = quick light sweep, then settle
  - transitions     = wipes for produced moments, hard cuts inside live debate

SCENES (7 total):
  1. Cold open       0:00-0:15  three split-screens, "ECHO CHAMBERS" text
  2. App reveal      0:15-0:30  UI assembles like a control room going live
  3. Entry points    0:30-0:50  source picker montage, framings appear
  4. Debate          0:50-1:20  three anchors take turns, tile glow follows speaker
  5. Fact-check      1:20-1:40  card slides up, verdict pills, push-in on DISPUTED
  6. Highlight reel  1:40-1:55  click → render bar → MP4 plays full-width
  7. Future + tag    1:55-2:05  mockup cards flash, brand lockup

DELIVERABLES NEEDED:
  - 7 storyboard frames (one per scene), 16:9
  - Brand lockup (logo + tagline) in gold on dark
  - 3 anchor avatar treatments (red/blue/gold rim-light examples)
  - Lower-third name plate template
  - Fact-check card template
  - Ticker bar template
```
