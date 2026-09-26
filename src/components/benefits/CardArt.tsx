import { cardArtColors } from "@/lib/colors";
import { ISSUER_LABELS } from "@/lib/categories";

/**
 * The card's face, beside its details.
 *
 * `src` is what a real card image will come through — nothing stores one yet,
 * so every card falls back to a deterministic colour pair. The fallback is not
 * a loading state: a card with no image keeps this face indefinitely, so it has
 * to be readable on its own, which is why it carries the issuer and last four.
 */
export function CardArt({
  issuer,
  last4,
  name,
  src,
  width = 92,
  label: labelOverride,
}: {
  issuer: string;
  last4: string;
  name: string | null;
  src?: string | null;
  /** In px. Below 60 the fallback face drops its text, which would not fit. */
  width?: number;
  /** Alt text and tooltip, when the card is known by another name. */
  label?: string;
}) {
  const label =
    labelOverride ?? `${ISSUER_LABELS[issuer] ?? issuer}${name ? ` ${name}` : ""} ending ${last4}`;
  const small = width < 60;
  // Seeded on the card's own identity, not its position, so reordering cards
  // never repaints them.
  const { from, to } = cardArtColors(issuer, `${issuer}-${name ?? ""}-${last4}`);

  // 1.586:1 — the ISO/IEC 7810 ID-1 ratio every bank card is cut to.
  const shell = "relative aspect-[1.586] shrink-0 overflow-hidden rounded-md";

  if (src) {
    // A local file of unknown dimensions, and this app has no image loader to
    // optimize through, so next/image would only demand a width and height it
    // cannot know.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={label}
        title={label}
        style={{ width }}
        className={`${shell} object-cover`}
      />
    );
  }

  return (
    <div
      className={shell}
      role="img"
      aria-label={label}
      title={label}
      style={{ width, background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {/* A band of light across the face: enough to read as a card rather than
          a colour swatch, without pretending to be one. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, transparent 38%, rgba(255,255,255,0.16) 50%, transparent 62%)",
        }}
      />
      {!small && (
        <>
          <span className="absolute left-2 top-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/80">
            {ISSUER_LABELS[issuer] ?? issuer}
          </span>
          <span className="absolute bottom-1.5 left-2 font-mono text-[10px] tabular-nums text-white/70">
            ··{last4}
          </span>
        </>
      )}
    </div>
  );
}
