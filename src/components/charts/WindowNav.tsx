"use client";

// Shared month-window controls: pan (‹ ›) on the left, zoom (− +) on the right.
export function WindowNav({
  onPan,
  onZoom,
  canEarlier,
  canLater,
  canZoomIn,
  canZoomOut,
}: {
  onPan: (dir: number) => void;
  onZoom?: (dir: number) => void;
  canEarlier: boolean;
  canLater: boolean;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
}) {
  const btn =
    "px-2 py-1 text-sm text-black/60 hover:text-foreground disabled:opacity-30 dark:text-white/60";
  const group = "flex items-center rounded-md border border-black/15 dark:border-white/15";
  const divider = "w-px self-stretch bg-black/15 dark:bg-white/15";

  return (
    <div className="flex items-center gap-2">
      <div className={group}>
        <button type="button" aria-label="Earlier" onClick={() => onPan(-1)} disabled={!canEarlier} className={btn}>
          ‹
        </button>
        <span className={divider} />
        <button type="button" aria-label="Later" onClick={() => onPan(1)} disabled={!canLater} className={btn}>
          ›
        </button>
      </div>
      {onZoom && (
        <div className={group}>
          <button type="button" aria-label="Fewer months" onClick={() => onZoom(-1)} disabled={!canZoomIn} className={btn}>
            −
          </button>
          <span className={divider} />
          <button type="button" aria-label="More months" onClick={() => onZoom(1)} disabled={!canZoomOut} className={btn}>
            +
          </button>
        </div>
      )}
    </div>
  );
}
