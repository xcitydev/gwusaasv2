"use client";

/**
 * Template-mode carousel slide renderer.
 *
 * Renders a 1080×1350 slide as real HTML: AI background scene underneath, a
 * legibility gradient, and razor-sharp typography on top — the way pro IG
 * carousels are actually built. Everything uses inline hex styles (no Tailwind
 * classes) so html2canvas can rasterize it — Tailwind v4's oklch colors would
 * crash its parser.
 */

import {
  memo,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  hexToRgb,
  type CarouselDeckSlide,
  type CarouselTemplate,
} from "@/lib/carousel-templates";

/** Route provider CDN images through our origin so canvas export isn't tainted. */
export function proxiedImageUrl(url: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

/** Loads a template's Google Fonts — React 19 hoists + dedupes these links. */
export function TemplateFonts({ template }: { template: CarouselTemplate }) {
  return <link rel="stylesheet" href={template.fontsUrl} precedence="default" />;
}

/** [[accent]] {{accent2}} ~~struck~~ ((outline)) and \n line breaks. */
function renderMarkup(raw: string, t: CarouselTemplate): ReactNode[] {
  const text = raw.replace(/\\n/g, "\n");
  const parts = text
    .split(/(\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\}|~~[\s\S]*?~~|\(\([\s\S]*?\)\)|\n)/g)
    .filter(Boolean);
  return parts.map((part, i) => {
    if (part === "\n") return <br key={i} />;
    if (part.startsWith("[[") && part.endsWith("]]")) {
      return (
        <span key={i} style={{ color: t.colors.accentBright }}>
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.startsWith("{{") && part.endsWith("}}")) {
      return (
        <span key={i} style={{ color: t.colors.accent2 }}>
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.startsWith("((") && part.endsWith("))")) {
      return (
        <span
          key={i}
          style={{ color: "transparent", WebkitTextStroke: `2.5px ${t.colors.text}` }}
        >
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return (
        <span key={i} style={{ position: "relative", whiteSpace: "nowrap" }}>
          {part.slice(2, -2)}
          <span
            style={{
              position: "absolute",
              left: "-1.5%",
              right: "-1.5%",
              top: "50%",
              height: 7,
              background: t.colors.accent,
              transform: "rotate(-2.4deg)",
              borderRadius: 4,
            }}
          />
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

type SlideProps = {
  slide: CarouselDeckSlide;
  template: CarouselTemplate;
  index: number;
  total: number;
  handle?: string;
  editable?: boolean;
};

/* ---------- reading edits back out of the DOM ---------- */

function normalizeColor(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return hexToRgb(v);
  return v.replace(/[^\d,]/g, "");
}

function colorMatches(styleColor: string, hex: string): boolean {
  return normalizeColor(styleColor) === hexToRgb(hex);
}

/** Inverse of renderMarkup: DOM → "text with [[markup]]" (edits preserved). */
function serializeMarkup(el: HTMLElement, t: CarouselTemplate): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeName === "BR") return "\n";
    if (!(node instanceof HTMLElement)) return "";
    if (node.style.position === "absolute") return ""; // the strike bar
    const inner = Array.from(node.childNodes).map(walk).join("");
    const hasStrikeBar = Array.from(node.children).some(
      (c) => c instanceof HTMLElement && c.style.position === "absolute",
    );
    if (hasStrikeBar) return `~~${inner}~~`;
    const color = node.style.color;
    if (color && colorMatches(color, t.colors.accentBright)) return `[[${inner}]]`;
    if (color && colorMatches(color, t.colors.accent2)) return `{{${inner}}}`;
    if (node.style.webkitTextStroke) return `((${inner}))`;
    return inner;
  };
  return Array.from(el.childNodes).map(walk).join("");
}

export type DeckSlideEdits = {
  kicker?: string;
  headline?: string;
  dek?: string;
  items?: { title: string; body: string }[];
  stat?: string;
  statLabel?: string;
  quote?: string;
  attribution?: string;
  keyword?: string;
  keywordLabel?: string;
  cta?: string;
};

/**
 * Diff the live (possibly edited) slide DOM against the stored slide.
 * Returns only the changed copy fields, or null when nothing changed.
 */
export function readSlideEdits(
  frameEl: HTMLDivElement,
  slide: CarouselDeckSlide,
  template: CarouselTemplate,
): DeckSlideEdits | null {
  const find = (name: string) =>
    frameEl.querySelector<HTMLElement>(`[data-field="${name}"]`);
  const edits: DeckSlideEdits = {};

  const markupFields = ["headline"] as const;
  for (const field of markupFields) {
    const el = find(field);
    if (!el || slide[field] === undefined) continue;
    const value = serializeMarkup(el, template).trim();
    if (value !== slide[field]!.replace(/\\n/g, "\n").trim()) edits[field] = value;
  }

  const plainFields = [
    "kicker",
    "dek",
    "stat",
    "statLabel",
    "quote",
    "attribution",
    "keyword",
    "keywordLabel",
    "cta",
  ] as const;
  for (const field of plainFields) {
    const el = find(field);
    if (!el || slide[field] === undefined) continue;
    const value = (el.textContent ?? "").trim();
    if (value !== slide[field]!.trim()) edits[field] = value;
  }

  if (slide.items && slide.items.length > 0) {
    let changed = false;
    const items = slide.items.map((item, i) => {
      const titleEl = find(`item-title-${i}`);
      const bodyEl = find(`item-body-${i}`);
      const title = titleEl ? serializeMarkup(titleEl, template).trim() : item.title;
      const body = bodyEl ? (bodyEl.textContent ?? "").trim() : item.body;
      if (title !== item.title.trim() || body !== item.body.trim()) changed = true;
      return { title, body };
    });
    if (changed) edits.items = items;
  }

  return Object.keys(edits).length > 0 ? edits : null;
}

function CarouselSlideInner({
  slide,
  template: t,
  index,
  total,
  handle,
  editable,
}: SlideProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const hasBg = Boolean(slide.bgUrl);
  const isCover = slide.type === "cover";
  const inkRgb = hexToRgb(t.colors.ink);
  const accentRgb = hexToRgb(t.colors.accent);

  const headlineBase = Math.round(
    (isCover ? 98 : slide.type === "stat" ? 76 : 84) * t.display.sizeFactor,
  );

  // Auto-fit: shrink the headline until it behaves, then scale body copy via
  // --fit until the whole slide clears 1350px. Direct DOM writes — measuring
  // real rendered heights, no re-render loops.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const head = headRef.current;
    if (head) {
      let size = headlineBase;
      head.style.fontSize = `${size}px`;
      const maxH = isCover ? 470 : 340;
      while (head.scrollHeight > maxH && size > 40) {
        size -= 3;
        head.style.fontSize = `${size}px`;
      }
    }
    let fit = 1;
    root.style.setProperty("--fit", "1");
    let guard = 0;
    while (root.scrollHeight > 1350 && fit > 0.6 && guard < 40) {
      guard++;
      fit = +(fit - 0.02).toFixed(2);
      root.style.setProperty("--fit", String(fit));
    }
  }, [slide, t, headlineBase, isCover]);

  const ed = editable
    ? { contentEditable: true, suppressContentEditableWarning: true }
    : {};

  const shadow = hasBg
    ? `0 2px 24px rgba(${inkRgb},0.9), 0 0 4px rgba(${inkRgb},0.6)`
    : undefined;
  const center = hasBg
    ? ({ textAlign: "center", alignSelf: "center" } as CSSProperties)
    : {};

  const displayFont: CSSProperties = {
    fontFamily: t.display.family,
    fontWeight: t.display.weight,
    textTransform: t.display.transform,
    letterSpacing: t.display.letterSpacing,
  };

  return (
    <div
      ref={rootRef}
      style={
        {
          "--fit": "1",
          width: 1080,
          height: 1350,
          background: t.colors.ink,
          color: t.colors.text,
          position: "relative",
          overflow: "hidden",
          padding: "88px 78px 150px",
          display: "flex",
          flexDirection: "column",
          justifyContent: hasBg ? "flex-end" : "flex-start",
          fontFamily: t.bodyFamily,
          WebkitFontSmoothing: "antialiased",
        } as CSSProperties
      }
    >
      {/* background scene + legibility gradient */}
      {hasBg && (
        <div style={{ position: "absolute", inset: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxiedImageUrl(slide.bgUrl!)}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(180deg, rgba(${inkRgb},0) 0%, rgba(${inkRgb},0) 40%, rgba(${inkRgb},0.6) 64%, rgba(${inkRgb},0.97) 100%)`,
            }}
          />
        </div>
      )}
      {/* ambient accent wash while the background renders */}
      {!hasBg && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(760px 520px at 88% 8%, rgba(${accentRgb},0.13), transparent 62%), radial-gradient(560px 420px at 6% 96%, rgba(${accentRgb},0.08), transparent 66%)`,
          }}
        />
      )}

      {hasBg && <div style={{ flex: "1 1 auto" }} />}

      {slide.kicker && (
        <div
          {...ed}
          data-field="kicker"
          style={{
            position: "relative",
            fontSize: "calc(19px * var(--fit,1))",
            letterSpacing: "0.34em",
            textTransform: "uppercase",
            color: t.colors.accent,
            fontWeight: 600,
            marginBottom: "calc(30px * var(--fit,1))",
            textShadow: shadow,
            ...center,
          }}
        >
          {slide.kicker}
        </div>
      )}

      {slide.headline && (
        <h2
          {...ed}
          data-field="headline"
          ref={headRef}
          style={{
            position: "relative",
            ...displayFont,
            fontSize: headlineBase,
            lineHeight: 1.08,
            margin: `0 0 calc(30px * var(--fit,1))`,
            whiteSpace: "pre-wrap",
            textShadow: shadow,
            maxWidth: "100%",
            ...center,
          }}
        >
          {renderMarkup(slide.headline, t)}
        </h2>
      )}

      {slide.dek && (
        <p
          {...ed}
          data-field="dek"
          style={{
            position: "relative",
            fontSize: "calc(28px * var(--fit,1))",
            lineHeight: 1.5,
            fontStyle: "italic",
            fontWeight: 500,
            color: t.colors.text,
            opacity: hasBg ? 0.88 : 0.75,
            margin: `0 0 calc(34px * var(--fit,1))`,
            maxWidth: hasBg ? "100%" : "94%",
            textShadow: shadow,
            ...center,
          }}
        >
          {slide.dek}
        </p>
      )}

      {slide.stat && (
        <div style={{ position: "relative", marginBottom: "calc(30px * var(--fit,1))", ...center }}>
          <div
            {...ed}
            data-field="stat"
            style={{
              ...displayFont,
              fontSize: Math.round(230 * t.display.sizeFactor),
              lineHeight: 0.84,
              color: t.colors.accentBright,
              textShadow: shadow,
            }}
          >
            {slide.stat}
          </div>
          {slide.statLabel && (
            <div
              {...ed}
              data-field="statLabel"
              style={{
                fontSize: "calc(25px * var(--fit,1))",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: hasBg ? t.colors.text : t.colors.muted,
                opacity: hasBg ? 0.85 : 1,
                marginTop: 16,
                textShadow: shadow,
              }}
            >
              {slide.statLabel}
            </div>
          )}
        </div>
      )}

      {slide.quote && (
        <div style={{ position: "relative", marginBottom: "calc(28px * var(--fit,1))" }}>
          <blockquote
            {...ed}
            data-field="quote"
            style={{
              fontSize: "calc(52px * var(--fit,1))",
              lineHeight: 1.22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
              borderLeft: `6px solid ${t.colors.accent}`,
              paddingLeft: 34,
              textAlign: "left",
              textShadow: shadow,
            }}
          >
            {slide.quote}
          </blockquote>
          {slide.attribution && (
            <div
              {...ed}
              data-field="attribution"
              style={{
                fontSize: "calc(22px * var(--fit,1))",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: hasBg ? t.colors.text : t.colors.muted,
                opacity: hasBg ? 0.8 : 1,
                marginTop: 20,
                paddingLeft: 40,
                textAlign: "left",
                textShadow: shadow,
              }}
            >
              {slide.attribution}
            </div>
          )}
        </div>
      )}

      {slide.items && slide.items.length > 0 && (
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "calc(30px * var(--fit,1))",
            marginBottom: "calc(32px * var(--fit,1))",
            textAlign: "left",
            ...(hasBg
              ? {
                  background: `rgba(${inkRgb},0.62)`,
                  border: `1px solid rgba(${accentRgb},0.25)`,
                  borderRadius: 14,
                  padding: "30px 34px",
                }
              : {}),
          }}
        >
          {slide.items.map((item, i) => (
            <div key={i}>
              <h3
                {...ed}
                data-field={`item-title-${i}`}
                style={{
                  margin: "0 0 10px",
                  fontSize: "calc(36px * var(--fit,1))",
                  fontWeight: 700,
                  letterSpacing: "-0.015em",
                  lineHeight: 1.22,
                }}
              >
                {renderMarkup(item.title, t)}
              </h3>
              <p
                {...ed}
                data-field={`item-body-${i}`}
                style={{
                  margin: 0,
                  fontSize: "calc(23px * var(--fit,1))",
                  lineHeight: 1.55,
                  color: hasBg ? t.colors.text : t.colors.muted,
                  opacity: hasBg ? 0.8 : 1,
                }}
              >
                {item.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {slide.keyword && (
        <div
          style={{
            position: "relative",
            alignSelf: hasBg ? "center" : "flex-start",
            border: `2px dashed ${t.colors.accent}`,
            borderRadius: 10,
            padding: "22px 44px",
            marginBottom: "calc(28px * var(--fit,1))",
            background: hasBg ? `rgba(${inkRgb},0.5)` : "transparent",
            textAlign: hasBg ? "center" : "left",
          }}
        >
          <b
            {...ed}
            data-field="keyword"
            style={{
              ...displayFont,
              fontSize: Math.round(74 * t.display.sizeFactor),
              color: t.colors.accentBright,
              letterSpacing: "0.04em",
              display: "block",
              lineHeight: 1,
            }}
          >
            {slide.keyword}
          </b>
          <small
            {...ed}
            data-field="keywordLabel"
            style={{
              fontSize: 20,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: hasBg ? t.colors.text : t.colors.muted,
              opacity: hasBg ? 0.75 : 1,
              display: "block",
              marginTop: 10,
            }}
          >
            {slide.keywordLabel || "comment this word"}
          </small>
        </div>
      )}

      {slide.cta && (
        <div
          style={{
            position: "relative",
            marginTop: hasBg ? 6 : "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: hasBg ? "center" : "flex-start",
            gap: 20,
            borderTop: hasBg ? "none" : `1px solid ${t.colors.line}`,
            paddingTop: hasBg ? 10 : 30,
            fontSize: hasBg ? 26 : 30,
            fontWeight: 700,
            letterSpacing: hasBg ? "0.06em" : "0.03em",
            textTransform: "uppercase",
            textShadow: shadow,
          }}
        >
          <span {...ed} data-field="cta">{slide.cta}</span>
          <span style={{ color: t.colors.accent, fontSize: 40, lineHeight: 1 }}>→</span>
        </div>
      )}

      {/* footer furniture */}
      <div
        style={{
          position: "absolute",
          left: 78,
          right: 78,
          bottom: 56,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 21,
            fontWeight: 600,
            color: hasBg ? t.colors.text : t.colors.muted,
            opacity: hasBg ? 0.65 : 1,
            textShadow: shadow,
          }}
        >
          {handle || ""}
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontFamily: t.monoFamily,
            fontSize: 18,
            letterSpacing: "0.14em",
            color: hasBg ? t.colors.text : t.colors.muted,
            opacity: hasBg ? 0.55 : 1,
            textShadow: shadow,
          }}
        >
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 8,
          background: t.colors.accent,
          width: `${Math.round(((index + 1) / total) * 100)}%`,
        }}
      />
    </div>
  );
}

const CarouselSlide = memo(CarouselSlideInner);

/** Scaled-down frame around a full-size slide. */
export function CarouselSlideFrame({
  width,
  frameRef,
  ...slideProps
}: SlideProps & { width: number; frameRef?: RefObject<HTMLDivElement | null> }) {
  const scale = width / 1080;
  return (
    <div
      ref={frameRef}
      style={{
        width,
        height: Math.round(1350 * scale),
        overflow: "hidden",
        borderRadius: 10,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: 1080,
          height: 1350,
        }}
      >
        <CarouselSlide {...slideProps} />
      </div>
    </div>
  );
}

/**
 * Rasterize a frame's slide to a 2160×2700 PNG download. Temporarily unscales
 * the frame (html2canvas measures live layout), captures, restores.
 */
export async function exportSlidePng(
  frameEl: HTMLDivElement,
  template: CarouselTemplate,
  filename: string,
): Promise<void> {
  const inner = frameEl.firstElementChild as HTMLElement | null;
  const node = inner?.firstElementChild as HTMLElement | null;
  if (!inner || !node) throw new Error("Slide not rendered yet");

  await document.fonts.ready;
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
    ),
  );

  const prev = {
    transform: inner.style.transform,
    width: frameEl.style.width,
    height: frameEl.style.height,
    overflow: frameEl.style.overflow,
  };
  inner.style.transform = "none";
  frameEl.style.width = "1080px";
  frameEl.style.height = "1350px";
  frameEl.style.overflow = "visible";
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(node, {
      backgroundColor: template.colors.ink,
      scale: 2,
      width: 1080,
      height: 1350,
      useCORS: true,
      logging: false,
    });
    const a = document.createElement("a");
    a.download = filename;
    a.href = canvas.toDataURL("image/png");
    a.click();
  } finally {
    inner.style.transform = prev.transform;
    frameEl.style.width = prev.width;
    frameEl.style.height = prev.height;
    frameEl.style.overflow = prev.overflow;
  }
}
