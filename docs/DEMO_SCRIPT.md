# LiveAvatar Election Desk — 2-Minute Demo Script

> **Target length:** 1:55–2:05.  Cut anything that doesn't earn its second.
> **Voice:** First-person, you (the builder). Confident, fast, no hedging.
> **B-roll:** Screen recording of the running app + occasional zoom on UI elements.

For scene-by-scene visual direction (color, motion, typography, transitions) see [VISUAL_SCRIPT.md](VISUAL_SCRIPT.md).

---

## The Script

### [00:00 – 00:15]  COLD OPEN — The fragmentation problem
**ON SCREEN:** Triple split — Fox-style red graphic, MSNBC-style blue graphic, late-night-style yellow — all running the **same headline** with three opposite framings. Audio of overlapping anchors fades up then out.
**YOU:**
> "When I switch from Fox to MSNBC to a late-night show, the same story can feel like three different countries. We're stuck in echo chambers."

### [00:15 – 00:30]  THE FIX
**ON SCREEN:** The three split-screens collapse into one — the Election Desk app, three avatar tiles lit, breaking bar pulsing.
**YOU:**
> "So I built the **LiveAvatar Election Desk** — three AI anchors, one story, every perspective on screen at once."

### [00:30 – 00:50]  ENTRY POINTS — Pick any source
**ON SCREEN:** Quick montage on the source picker — demo story → paste an article URL → flip to RSS / live feed mode. URL pastes, article loads, Story Inspector populates with neutral / left / right framings.
**YOU:**
> "Drop in any article URL. Or pull from an RSS feed. The desk extracts the story and generates left, right, and neutral framings — automatically."

### [00:50 – 01:20]  THE DEBATE — Anchors actually respond to each other
**ON SCREEN:** Type "What's the strongest argument on each side?" → send. Maya (left, red accent) speaks first. Cole (right, blue accent) cuts in with a direct rebuttal. Avery (neutral, gold accent) closes the round. HUD ticker crawls; breaking bar pulses.
**YOU:**
> "Three avatars stream over WebRTC. An LLM picks who speaks next based on what was just said, so they actually respond to each other instead of monologuing. The newsroom graphics regenerate every round to reflect what was just argued."

### [01:20 – 01:40]  REAL-TIME FACT-CHECK
**ON SCREEN:** A fact-check card slides under Cole's last turn — green "Verified" pill on one claim, red "Disputed" on another, source URLs highlighted.
**YOU:**
> "Every claim is fact-checked live by Gemini against Google Search and the source article — in parallel with the speech, so there's no added latency. The next anchor sees the verdicts and builds on them."

### [01:40 – 01:55]  ONE-CLICK HIGHLIGHT REEL
**ON SCREEN:** Click "Render Highlight Reel" → progress bar → MP4 plays full-screen with chyrons and ticker baked in.
**YOU:**
> "And one click renders a broadcast-quality highlight reel — every turn was captured in the browser, then composed server-side with Hyperframes."

### [01:55 – 02:05]  FUTURE + TAG
**ON SCREEN:** Quick mockup flashes — "Morning Briefing" notification → 2-hour rally video → instant highlight clips popping out. Cut to the desk view + logo.
**YOU:**
> "Next: morning briefings, instant highlights from two-hour rallies. **LiveAvatar Election Desk** — three perspectives, one screen. Built on Anoki LiveAvatar."

---

## Storyboard Cheat-Sheet

| Beat | Duration | Camera/Zoom | Audio |
|------|---------|-------------|-------|
| Cold open | 15s | Triple split-screen mock, then collapse to one | Overlapping anchor audio fades down to VO |
| The fix | 15s | Wide of full UI as it assembles | VO + soft brand sting |
| Entry points | 20s | Cursor-level montage of source picker | VO + click SFX |
| Debate | 30s | Tile-by-tile zoom on each speaker, then wide | VO ducked under anchor speech |
| Fact-check | 20s | Zoom on fact-check card, verdict pills pop | VO |
| Reel | 15s | Render button → MP4 playback full-screen | VO trails into reel audio |
| Future + tag | 10s | Mockup flashes → logo + tagline | VO + fade |

---

## Pre-Recording Checklist

- [ ] Clear `localStorage` for clean LLM-config defaults
- [ ] Pre-warm all 3 anchor sessions (load demo story once, then reset)
- [ ] Pick an article URL you've already tested — don't gamble live
- [ ] Verify `OPENAI_API_KEY` and `GEMINI_API_KEY` are loaded
- [ ] Confirm green-screen avatars are using chroma-key composite
- [ ] Test highlight reel render once before recording
- [ ] Record at 1920×1080, 60fps if possible
- [ ] Browser zoom = 100% (HUD math is pixel-tuned)
