import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorId, AnchorProfile, PublicAvatar } from "@shared/models";
import { anchorIds } from "@shared/models";
import { api } from "../lib/api";
import {
  createBrowserLiveSession,
  LiveAvatarSession,
  repeatAndWait,
  waitForStreamReady,
} from "../lib/liveavatar";

const STORAGE_KEY = "live-avatar/anchor-overrides/v1";

type Overrides = Partial<Record<AnchorId, { avatarId?: string; voiceId?: string }>>;
type Gender = "female" | "male" | "unknown";
type GenderFilter = "all" | Gender;

const FEMALE_NAMES = new Set([
  "judy","elenora","marianne","ann","amina","alessandra","sarah","jane","emma","emily","stella",
  "anna","alice","amy","beth","betty","claire","diana","ella","eva","grace","hannah","julia",
  "katie","laura","lily","linda","lisa","lucy","maya","mia","molly","nina","olivia","sandra",
  "sophia","tina","zoe","carla","clara","helen","ivy","leah","mary","nora","rosa","ruth","sara",
  "tara","vera","yara","yuki","kira","aiko","maria","isabel","luna","wendy","becca","chloe",
  "harper","violet","scarlett","ada","kim","ada","rose","fiona","mei","nia","nadia","priya",
  "sasha","tessa","willow","aurora","brielle","celeste","daria","ester","gemma","ines","jada",
  "katia","leila","mara","nicole","ophelia","paula","quinn","raquel","selena","tamara","uma",
  "vivian","yvette","zara","abby","penny","alana","amelia","ashley","brooke","camila","carolina",
  "carolyn","christina","cynthia","danielle","deborah","denise","diane","donna","elena","ellen",
  "erica","esther","felicia","frances","gabriela","gloria","heather","heidi","irene","jasmine",
  "jennifer","jessica","joan","julianne","kathy","kelly","kimberly","kristen","lauren","lillian",
  "linda","lori","margaret","martha","melanie","melissa","mercedes","michelle","michele","nancy",
  "natalie","natasha","nicole","pamela","patricia","peggy","rachel","rebecca","regina","renee",
  "rita","robin","rosa","sandra","shannon","sharon","sheila","shirley","stephanie","susan","tammy",
  "teresa","theresa","tracy","valerie","veronica","virginia","wanda","whitney","yolanda","yvonne",
]);

const MALE_NAMES = new Set([
  "dexter","bryan","wayne","mike","mark","matt","matthew","john","james","robert","michael",
  "david","william","richard","joseph","thomas","charles","christopher","daniel","paul","steven",
  "kenneth","andrew","joshua","kevin","brian","george","timothy","ronald","jason","edward",
  "jeffrey","ryan","jacob","gary","nicholas","eric","stephen","jonathan","larry","justin","scott",
  "frank","brandon","raymond","gregory","samuel","patrick","alexander","jack","dennis","jerry",
  "tyler","aaron","jose","henry","adam","douglas","nathan","peter","zachary","walter","kyle",
  "harold","carl","jeremy","keith","roger","gerald","ethan","arthur","terry","christian","sean",
  "lawrence","austin","joe","noah","jesse","albert","bruce","willie","jordan","dylan","alan","ralph",
  "gabriel","roy","juan","wayne","randy","vincent","russell","louis","philip","bobby","johnny",
  "bradley","cole","brennan","reid","holt","bryce","ben","sam","tom","chris","dan","drew","ed",
  "evan","ian","jack","leo","luke","max","oliver","owen","theo","felix","hugo","julian","liam",
  "miles","nathan","sebastian","wesley","xavier","zane","carlos","diego","mateo","santiago","akira",
  "hiro","ken","ravi","arjun","kai","tariq","omar","mohammed","ahmed","ali",
]);

function firstName(name: string | undefined): string {
  if (!name) {
    return "";
  }
  const cleaned = name.replace(/[^a-zA-Z\s]/g, " ").trim();
  const token = cleaned.split(/\s+/)[0] ?? "";
  return token.toLowerCase();
}

function inferGender(avatar: PublicAvatar): Gender {
  const candidates = [avatar.default_voice?.name, avatar.name];
  for (const candidate of candidates) {
    const first = firstName(candidate);
    if (FEMALE_NAMES.has(first)) {
      return "female";
    }
    if (MALE_NAMES.has(first)) {
      return "male";
    }
  }
  return "unknown";
}

const desiredGenderForAnchor: Record<AnchorId, Gender> = {
  neutral: "female",
  left: "female",
  right: "male",
};

function loadStoredOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Overrides;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredOverrides(overrides: Overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore quota/serialization issues — overrides also live server-side.
  }
}

interface AvatarGalleryModalProps {
  open: boolean;
  onClose: () => void;
  anchors: AnchorProfile[];
  onApplied: () => void;
}

export function AvatarGalleryModal({ open, onClose, anchors, onApplied }: AvatarGalleryModalProps) {
  const [avatars, setAvatars] = useState<PublicAvatar[]>([]);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>(() => loadStoredOverrides());
  const [savingAnchor, setSavingAnchor] = useState<AnchorId | null>(null);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "speaking">("idle");
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewSessionRef = useRef<{
    browserSession?: LiveAvatarSession;
    sessionId?: string;
    sessionAccessToken?: string;
  } | null>(null);
  const previewCancelTokenRef = useRef(0);

  const pageSize = 24;

  const fetchPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.listPublicAvatars({ page: nextPage, pageSize });
      setAvatars(payload.results ?? []);
      setCount(payload.count ?? 0);
      setHasNext(Boolean(payload.next));
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load avatars.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (avatars.length === 0) {
      void fetchPage(1);
    }
  }, [open, avatars.length, fetchPage]);

  useEffect(() => {
    return () => {
      void teardownPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function teardownPreview() {
    previewCancelTokenRef.current += 1;
    const audio = playingAudioRef.current;
    if (audio) {
      audio.pause();
      playingAudioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const previewSession = previewSessionRef.current;
    if (previewSession) {
      previewSessionRef.current = null;
      await previewSession.browserSession?.stop().catch(() => undefined);
      if (previewSession.sessionId && previewSession.sessionAccessToken) {
        await api
          .stopPreviewSession({
            sessionId: previewSession.sessionId,
            sessionAccessToken: previewSession.sessionAccessToken,
          })
          .catch(() => undefined);
      }
    }
    setPreviewingId(null);
    setPreviewStatus("idle");
  }

  const totalPages = useMemo(() => (count > 0 ? Math.max(1, Math.ceil(count / pageSize)) : 1), [count]);

  const filteredAvatars = useMemo(() => {
    if (genderFilter === "all") {
      return avatars;
    }
    return avatars.filter((avatar) => inferGender(avatar) === genderFilter);
  }, [avatars, genderFilter]);

  function playSyntheticPreview(avatar: PublicAvatar) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setError("Voice preview not available in this browser.");
      setPreviewingId(null);
      setPreviewStatus("idle");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(
      `Hi, I'm ${avatar.name}. This is a synthetic preview — the live avatar voice will sound different.`,
    );
    utterance.rate = 1.05;
    const gender = inferGender(avatar);
    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find((voice) => {
      const lower = voice.name.toLowerCase();
      if (gender === "female") return /female|samantha|victoria|karen|moira|tessa|fiona/.test(lower);
      if (gender === "male") return /male|daniel|fred|alex|tom|aaron/.test(lower);
      return false;
    });
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
    utterance.onend = () => {
      setPreviewingId(null);
      setPreviewStatus("idle");
    };
    utterance.onerror = () => {
      setPreviewingId(null);
      setPreviewStatus("idle");
    };
    setPreviewStatus("speaking");
    window.speechSynthesis.speak(utterance);
  }

  async function previewVoice(avatar: PublicAvatar) {
    if (previewingId === avatar.id) {
      await teardownPreview();
      return;
    }
    await teardownPreview();

    setError(null);
    setPreviewingId(avatar.id);

    // Cached static preview if LiveAvatar surfaces one.
    const previewUrl = avatar.default_voice?.preview_url;
    if (previewUrl) {
      const audio = new Audio(previewUrl);
      audio.onended = () => {
        setPreviewingId(null);
        setPreviewStatus("idle");
      };
      audio.onerror = () => {
        setPreviewingId(null);
        setPreviewStatus("idle");
      };
      setPreviewStatus("speaking");
      void audio.play().catch(() => {
        setPreviewingId(null);
        setPreviewStatus("idle");
      });
      playingAudioRef.current = audio;
      return;
    }

    // Real preview: ask the server for a short-lived session token for this
    // avatar, attach a hidden video element, speak a single line, then stop.
    setPreviewStatus("loading");
    const token = ++previewCancelTokenRef.current;
    try {
      const tokenResponse = await api.previewAvatarToken({
        avatarId: avatar.id,
        voiceId: avatar.default_voice?.id,
      });
      if (token !== previewCancelTokenRef.current) {
        // User cancelled before token arrived — clean up the session we just paid for.
        await api
          .stopPreviewSession({
            sessionId: tokenResponse.sessionId,
            sessionAccessToken: tokenResponse.sessionAccessToken,
          })
          .catch(() => undefined);
        return;
      }

      const browserSession = await createBrowserLiveSession(
        tokenResponse.sessionAccessToken,
        undefined,
        (session) => {
          const videoElement = previewVideoRef.current;
          if (videoElement) {
            session.attach(videoElement);
            void videoElement.play().catch(() => undefined);
          }
        },
      );
      previewSessionRef.current = {
        browserSession,
        sessionId: tokenResponse.sessionId,
        sessionAccessToken: tokenResponse.sessionAccessToken,
      };

      await waitForStreamReady(browserSession, 12000);
      if (token !== previewCancelTokenRef.current) {
        return;
      }

      setPreviewStatus("speaking");
      await repeatAndWait(browserSession, `Hi, I'm ${avatar.name}. This is what I sound like.`);
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : String(previewError);
      setError(`Live preview failed (${message}). Playing a synthetic preview instead.`);
      playSyntheticPreview(avatar);
      return;
    } finally {
      // Stop the LiveAvatar session whether we finished or errored — we only
      // need ~6 seconds of compute per preview.
      if (token === previewCancelTokenRef.current) {
        const previewSession = previewSessionRef.current;
        previewSessionRef.current = null;
        if (previewSession) {
          await previewSession.browserSession?.stop().catch(() => undefined);
          if (previewSession.sessionId && previewSession.sessionAccessToken) {
            await api
              .stopPreviewSession({
                sessionId: previewSession.sessionId,
                sessionAccessToken: previewSession.sessionAccessToken,
              })
              .catch(() => undefined);
          }
        }
        setPreviewingId(null);
        setPreviewStatus("idle");
      }
    }
  }

  async function applyOverride(anchorId: AnchorId, avatar: PublicAvatar) {
    const nextOverride = {
      avatarId: avatar.id,
      voiceId: avatar.default_voice?.id,
    };
    const nextOverrides: Overrides = {
      ...overrides,
      [anchorId]: nextOverride,
    };
    setOverrides(nextOverrides);
    saveStoredOverrides(nextOverrides);

    setSavingAnchor(anchorId);
    try {
      await api.setAnchorRuntimeConfig({ overrides: { [anchorId]: nextOverride } });
      onApplied();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to apply avatar.");
    } finally {
      setSavingAnchor(null);
    }
  }

  async function autoPick() {
    // Gender-aware auto-pick: try to fill each anchor with its preferred
    // gender (Avery female, Maya female, Cole male). Falls back to "unknown"
    // when not enough gendered avatars are on this page.
    const buckets: Record<Gender, PublicAvatar[]> = { female: [], male: [], unknown: [] };
    for (const avatar of avatars) {
      buckets[inferGender(avatar)].push(avatar);
    }
    const used = new Set<string>();
    const picks: Partial<Record<AnchorId, PublicAvatar>> = {};

    const claim = (anchorId: AnchorId, pool: PublicAvatar[]): boolean => {
      for (const avatar of pool) {
        if (!used.has(avatar.id)) {
          used.add(avatar.id);
          picks[anchorId] = avatar;
          return true;
        }
      }
      return false;
    };

    for (const anchorId of anchorIds) {
      const desired = desiredGenderForAnchor[anchorId];
      const ordered =
        desired === "female"
          ? [buckets.female, buckets.unknown, buckets.male]
          : desired === "male"
            ? [buckets.male, buckets.unknown, buckets.female]
            : [buckets.unknown, buckets.female, buckets.male];

      let claimed = false;
      for (const pool of ordered) {
        if (claim(anchorId, pool)) {
          claimed = true;
          break;
        }
      }
      if (!claimed) {
        setError("Not enough avatars on this page to assign all three anchors. Try the next page.");
        return;
      }
    }

    const nextOverrides: Overrides = { ...overrides };
    const payloadOverrides: Overrides = {};
    for (const anchorId of anchorIds) {
      const avatar = picks[anchorId];
      if (!avatar) continue;
      const override = { avatarId: avatar.id, voiceId: avatar.default_voice?.id };
      nextOverrides[anchorId] = override;
      payloadOverrides[anchorId] = override;
    }
    setOverrides(nextOverrides);
    saveStoredOverrides(nextOverrides);

    setSavingAnchor("neutral");
    try {
      await api.setAnchorRuntimeConfig({ overrides: payloadOverrides });
      onApplied();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to apply avatars.");
    } finally {
      setSavingAnchor(null);
    }
  }

  if (!open) {
    return null;
  }

  function handleClose() {
    void teardownPreview();
    onClose();
  }

  return (
    <div className="avatar-gallery-overlay" role="dialog" aria-modal="true" onClick={handleClose}>
      <video
        ref={previewVideoRef}
        className="visually-hidden"
        muted={false}
        autoPlay
        playsInline
        aria-hidden="true"
      />
      <div className="avatar-gallery-modal" onClick={(event) => event.stopPropagation()}>
        <header className="avatar-gallery-header">
          <div>
            <h2>Choose avatars</h2>
            <p className="avatar-gallery-subtitle">
              Each anchor's avatar comes with its own habitat. Filter by inferred gender, listen to a voice sample, then assign.
            </p>
          </div>
          <div className="avatar-gallery-header-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={autoPick}
              disabled={loading || avatars.length === 0 || savingAnchor !== null}
              title="Automatically assign one avatar to each presenter, matching their preferred gender."
            >
              Auto-pick 3
            </button>
            <button
              type="button"
              className="ghost-action"
              onClick={handleClose}
              aria-label="Close avatar gallery"
              title="Close the avatar picker."
            >
              ✕
            </button>
          </div>
        </header>

        <div className="avatar-gallery-filter">
          {(["all", "female", "male", "unknown"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`toggle-chip ${genderFilter === option ? "toggle-chip-selected" : ""}`}
              onClick={() => setGenderFilter(option)}
              title={
                option === "all"
                  ? "Show every avatar on this page."
                  : option === "unknown"
                    ? "Show only avatars whose gender couldn't be guessed from the name."
                    : `Show only avatars guessed to be ${option}.`
              }
            >
              {option === "all" ? "All" : option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
          <span className="avatar-gallery-filter-hint">
            Gender inferred from the avatar/voice name — not always accurate; tweak manually.
          </span>
        </div>

        {error ? <p className="control-error avatar-gallery-error">{error}</p> : null}

        <div className="avatar-gallery-body">
          {loading && avatars.length === 0 ? (
            <p className="avatar-gallery-status">Loading avatars…</p>
          ) : filteredAvatars.length === 0 ? (
            <p className="avatar-gallery-status">
              {avatars.length === 0
                ? "No avatars returned. Check your LiveAvatar API key."
                : "No avatars match this gender filter on this page."}
            </p>
          ) : (
            <ul className="avatar-gallery-grid">
              {filteredAvatars.map((avatar) => {
                const gender = inferGender(avatar);
                const assignedTo = anchorIds.filter((anchorId) => overrides[anchorId]?.avatarId === avatar.id);
                const isPreviewing = previewingId === avatar.id;
                return (
                  <li key={avatar.id} className="avatar-card">
                    {avatar.preview_url ? (
                      <img src={avatar.preview_url} alt={avatar.name} loading="lazy" />
                    ) : (
                      <div className="avatar-card-placeholder">{avatar.name.slice(0, 2)}</div>
                    )}
                    <div className="avatar-card-body">
                      <div className="avatar-card-titlerow">
                        <strong>{avatar.name}</strong>
                        <span className={`avatar-card-gender avatar-card-gender-${gender}`}>{gender}</span>
                      </div>
                      {avatar.default_voice?.name ? (
                        <small className="avatar-card-voice">Voice: {avatar.default_voice.name}</small>
                      ) : null}
                      {assignedTo.length > 0 ? (
                        <small className="avatar-card-assigned">
                          ✓ Assigned to {assignedTo.map((id) => anchors.find((a) => a.id === id)?.shortLabel ?? id).join(", ")}
                        </small>
                      ) : null}
                      <button
                        type="button"
                        className="ghost-action avatar-card-preview-btn"
                        onClick={() => void previewVoice(avatar)}
                        title={isPreviewing ? "Stop the voice preview." : `Hear a short sample of ${avatar.name}'s voice.`}
                      >
                        {isPreviewing
                          ? previewStatus === "loading"
                            ? "● Starting…"
                            : previewStatus === "speaking"
                              ? "■ Stop"
                              : "■ Stop"
                          : "▶ Preview voice"}
                      </button>
                      <div className="avatar-card-assign-label">Assign to:</div>
                      <div className="avatar-card-actions">
                        {anchors.map((profile) => {
                          const alreadyHere = overrides[profile.id]?.avatarId === avatar.id;
                          return (
                            <button
                              key={profile.id}
                              type="button"
                              className={`toggle-chip avatar-card-assign-chip ${alreadyHere ? "toggle-chip-selected" : ""}`}
                              onClick={() => applyOverride(profile.id, avatar)}
                              disabled={savingAnchor !== null}
                              title={`Assign ${avatar.name} to ${profile.label}`}
                            >
                              {savingAnchor === profile.id ? `${profile.shortLabel}…` : profile.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="avatar-gallery-footer">
          <span className="avatar-gallery-page">
            Page {page} of {totalPages} · {count} avatars
            {genderFilter !== "all" ? ` · showing ${filteredAvatars.length} ${genderFilter} this page` : null}
          </span>
          <div className="avatar-gallery-pagination">
            <button
              type="button"
              className="toggle-chip"
              onClick={() => fetchPage(Math.max(1, page - 1))}
              disabled={loading || page <= 1}
              title="Go to the previous page of avatars."
            >
              ← Prev
            </button>
            <button
              type="button"
              className="toggle-chip"
              onClick={() => fetchPage(page + 1)}
              disabled={loading || !hasNext}
              title="Go to the next page of avatars."
            >
              Next →
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
