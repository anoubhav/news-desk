import { useEffect, useRef, type CSSProperties } from "react";
import "@hyperframes/player";

// `@hyperframes/player` registers <hyperframes-player> as a custom element on
// import. React 19 lets us declare the tag in JSX via this module augmentation
// without needing an "is" prop.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": {
        src?: string;
        srcdoc?: string;
        width?: string | number;
        height?: string | number;
        controls?: boolean | "";
        muted?: boolean | "";
        volume?: string | number;
        poster?: string;
        "playback-rate"?: string | number;
        "audio-src"?: string;
        loop?: boolean | "";
        style?: CSSProperties;
        className?: string;
        ref?: React.Ref<HTMLElement>;
      };
    }
  }
}

type PlayerElement = HTMLElement & {
  play?: () => void;
  pause?: () => void;
  ready?: boolean;
};

export type HfPlayerProps = {
  src: string;
  width?: number | string;
  height?: number | string;
  controls?: boolean;
  muted?: boolean;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Thin React wrapper around the <hyperframes-player> custom element.
 * Boolean attrs are stringified to "" (present) or omitted (absent) — that's
 * the convention HTML uses for boolean attrs and what the web component reads.
 *
 * The player defaults to *paused* until you call `.play()`. We expose an
 * `autoplay` prop (default `true`) that calls play() once the player reports
 * `ready === true`. We poll briefly because `ready` flips asynchronously after
 * the player auto-injects the Hyperframes runtime into its iframe.
 */
export function HfPlayer({
  src,
  width = "100%",
  height = "100%",
  controls,
  muted,
  loop,
  autoplay = true,
  className,
  style,
}: HfPlayerProps) {
  const ref = useRef<PlayerElement | null>(null);

  useEffect(() => {
    if (!autoplay) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let attempts = 0;
    const tryPlay = () => {
      if (cancelled) return;
      attempts += 1;
      if (el.ready && typeof el.play === "function") {
        el.play();
        return;
      }
      if (attempts > 60) return; // ~12s @ 200ms
      window.setTimeout(tryPlay, 200);
    };
    tryPlay();
    return () => {
      cancelled = true;
    };
  }, [autoplay, src]);

  const attrs: Record<string, string | number | undefined> = { src, width, height };
  if (controls) attrs.controls = "";
  if (muted) attrs.muted = "";
  if (loop) attrs.loop = "";
  return (
    <hyperframes-player
      {...attrs}
      ref={ref as unknown as React.Ref<HTMLElement>}
      className={className}
      style={style}
    />
  );
}
