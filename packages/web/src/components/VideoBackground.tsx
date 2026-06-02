'use client';

import { useEffect, useRef } from 'react';

/**
 * Full-bleed video background — fixed to the viewport, plays under everything.
 *
 * - `muted` + `playsInline` so autoplay works on iOS Safari.
 * - playbackRate=0.5 set in an effect (HTML attribute would be ignored).
 * - Warm vignette overlay (see globals.css) keeps the page legible while
 *   letting the golden key glow through the center.
 */
export function VideoBackground() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = 0.5;
    // Some browsers reset rate when a new <source> is selected — re-apply.
    const onLoaded = () => { v.playbackRate = 0.5; };
    v.addEventListener('loadeddata', onLoaded);
    return () => v.removeEventListener('loadeddata', onLoaded);
  }, []);

  return (
    <>
      <video
        ref={ref}
        className="bg-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/key-bg-poster.jpg"
        aria-hidden="true"
      >
        <source src="/key-bg.webm" type="video/webm" />
        <source src="/key-bg.mp4" type="video/mp4" />
      </video>
      <div className="bg-overlay" aria-hidden="true" />
    </>
  );
}
