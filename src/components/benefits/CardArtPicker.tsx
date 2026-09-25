"use client";

import { useEffect, useRef, useState } from "react";
import {
  CROP_KEY,
  DEFAULT_CROP,
  detectCardRect,
  differenceMap,
  fromFractions,
  isCropFractions,
  matchesDefaultCrop,
  toFractions,
  type CropFractions,
  type Rect,
} from "@/lib/card-crop";
import { loadSynced, pushSynced } from "@/lib/ui-state";

/**
 * Turn a screenshot into a card face.
 *
 * The cropping happens here rather than on the server: the browser already
 * decodes any image format that can be picked, and a canvas gives the pixels
 * and the re-encode for free — so the server never needs an image library, and
 * what uploads is exactly what the preview showed.
 *
 * The box itself is the user's to set. Reading the edges is only a first
 * guess — it cannot find a top edge on a card whose art meets the backdrop —
 * so the numbers are shown as fields, and the position that gets saved is
 * offered again for the next screenshot, which is where the real leverage is:
 * Wallet puts every card in the same place on a given phone.
 */
export function CardArtPicker({
  cardId,
  hasArt,
  onChanged,
}: {
  cardId: string;
  hasArt: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The picked screenshot at full size, kept so re-cropping is a redraw rather
  // than another decode of the file.
  const source = useRef<{ canvas: HTMLCanvasElement; width: number; height: number } | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [origin, setOrigin] = useState<"saved" | "default" | "edges" | "whole">("edges");
  const [preview, setPreview] = useState<string | null>(null);

  const remembered = useRef<CropFractions | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSynced(CROP_KEY);
      if (cancelled || !isCropFractions(stored)) return;
      remembered.current = stored;
      setHasSaved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function clearAll() {
    setPreview((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    source.current = null;
    setDims(null);
    setRect(null);
    setError(null);
  }

  /** Redraw the preview for a box, and remember the box. */
  function render(box: Rect) {
    const src = source.current;
    if (!src) return;
    const clamped: Rect = {
      x: Math.max(0, Math.min(src.width - 1, Math.round(box.x))),
      y: Math.max(0, Math.min(src.height - 1, Math.round(box.y))),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    };
    clamped.width = Math.min(clamped.width, src.width - clamped.x);
    clamped.height = Math.min(clamped.height, src.height - clamped.y);
    setRect(clamped);

    const out = document.createElement("canvas");
    out.width = clamped.width;
    out.height = clamped.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      src.canvas,
      clamped.x, clamped.y, clamped.width, clamped.height,
      0, 0, clamped.width, clamped.height
    );
    out.toBlob((blob) => {
      if (!blob) return;
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    }, "image/png");
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      // close() leaves width and height reading zero, so take them first.
      const width = bitmap.width;
      const height = bitmap.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser would not give a canvas to draw on.");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      source.current = { canvas, width, height };
      setDims({ width, height });

      // A crop saved here beats the built-in one, which beats reading edges
      // that may not exist: the numbers are known for this screen, and what
      // was right for the last card is righter still.
      const saved = remembered.current && fromFractions(remembered.current, width, height);
      const builtIn = matchesDefaultCrop(width, height)
        ? fromFractions(DEFAULT_CROP, width, height)
        : null;
      if (saved) {
        setOrigin("saved");
        render(saved);
      } else if (builtIn) {
        setOrigin("default");
        render(builtIn);
      } else {
        const diff = differenceMap(ctx.getImageData(0, 0, width, height).data, width, height);
        const found = diff && detectCardRect(diff, width, height);
        setOrigin(found ? "edges" : "whole");
        render(found ?? { x: 0, y: 0, width, height });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = ""; // so the same file can be picked again
    }
  }

  function findEdges() {
    const src = source.current;
    if (!src) return;
    const ctx = src.canvas.getContext("2d");
    if (!ctx) return;
    const diff = differenceMap(ctx.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
    const found = diff && detectCardRect(diff, src.width, src.height);
    setOrigin(found ? "edges" : "whole");
    render(found ?? { x: 0, y: 0, width: src.width, height: src.height });
  }

  function useSaved() {
    const src = source.current;
    const box = remembered.current && src && fromFractions(remembered.current, src.width, src.height);
    if (!box) return;
    setOrigin("saved");
    render(box);
  }

  async function save() {
    const src = source.current;
    if (!src || !rect || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetch(preview).then((r) => r.blob());
      const r = await fetch(`/api/user-cards/${cardId}/art`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to save the image");
      // These numbers are the starting point for the next screenshot, since it
      // comes off the same phone and the same screen.
      const fractions = toFractions(rect, src.width, src.height);
      if (fractions) {
        remembered.current = fractions;
        setHasSaved(true);
        pushSynced(CROP_KEY, fractions);
      }
      clearAll();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the image");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/user-cards/${cardId}/art`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to remove the image");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove the image");
    } finally {
      setBusy(false);
    }
  }

  const link = "text-xs text-black/50 hover:text-foreground disabled:opacity-50 dark:text-white/50";
  const field =
    "w-[4.5rem] rounded border border-black/15 bg-transparent px-1 py-0.5 text-right font-mono text-[11px] tabular-nums outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40";

  const set = (key: keyof Rect) => (value: string) => {
    if (!rect) return;
    const n = parseInt(value, 10);
    render({ ...rect, [key]: Number.isFinite(n) ? n : 0 });
  };

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {preview && rect && dims ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="The card as it will be saved" className="w-[92px] rounded-md" />

          <span className="text-[10px] text-black/45 dark:text-white/45">
            {origin === "saved"
              ? "Saved position"
              : origin === "default"
                ? "Standard position"
                : origin === "edges"
                  ? "Read from the edges"
                  : "No card found — whole image"}
            {" · "}
            screenshot {dims.width}×{dims.height}
          </span>

          {/* The numbers, to set outright. Everything above only fills them in. */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {(["x", "y", "width", "height"] as const).map((key) => (
              <label key={key} className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase text-black/40 dark:text-white/40">{key}</span>
                <input
                  type="number"
                  value={rect[key]}
                  onChange={(e) => set(key)(e.target.value)}
                  className={field}
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => render({ ...rect, height: Math.round(rect.width / (85.6 / 53.98)) })}
              disabled={busy}
              className={link}
              title="Set the height from the width, at a bank card's proportions"
            >
              Fit height
            </button>
            <button type="button" onClick={findEdges} disabled={busy} className={link}>
              Read edges
            </button>
            {hasSaved && (
              <button type="button" onClick={useSaved} disabled={busy} className={link}>
                Saved position
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save image"}
            </button>
            <button type="button" onClick={clearAll} disabled={busy} className={link}>
              Cancel
            </button>
          </div>
          <span className="text-[10px] text-amber-700 dark:text-amber-400">Not saved yet</span>
        </>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className={link}>
            {busy ? "Reading…" : hasArt ? "Replace image" : "Add image"}
          </button>
          {hasArt && (
            <button type="button" onClick={remove} disabled={busy} className={link}>
              Remove image
            </button>
          )}
        </div>
      )}

      {error && <span className="text-[10px] text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
