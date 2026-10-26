"use client";

import Script from "next/script";

/**
 * Top aurora band (References/gold-bg.html): the reference's UnicornStudio
 * effect, pinned to the viewport top in a masked 800px band behind the
 * falling-beam grid. Same embed id and init guard as the reference.
 */

const UNICORN_STUDIO_SRC =
  "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js";

declare global {
  interface Window {
    UnicornStudio?: { isInitialized: boolean; init: () => void };
  }
}

export function Background({ contained = false }: { contained?: boolean }) {
  return (
    <div
      aria-hidden
      className={contained
        ? "pointer-events-none absolute inset-x-0 top-0 z-0 h-full"
        : "pointer-events-none fixed inset-x-0 top-0 z-0 h-[800px]"}
      style={{
        maskImage:
          "linear-gradient(180deg, transparent, black 0%, black 80%, transparent)",
        WebkitMaskImage:
          "linear-gradient(180deg, transparent, black 0%, black 80%, transparent)",
      }}
    >
      <div data-us-project="zNLwDraPwdiE0ELhd8Z4" className="absolute inset-0" />
      <Script
        src={UNICORN_STUDIO_SRC}
        onReady={() => {
          const studio = window.UnicornStudio;
          if (studio) {
            studio.init();
            studio.isInitialized = true;
          }
        }}
      />
    </div>
  );
}
