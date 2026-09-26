"use client";

import { useRef, useState } from "react";
import {
  cornerRadiusFor,
  detectCardRect,
  differenceMap,
  fromFractions,
  presetFor,
  type Rect,
} from "@/lib/card-crop";

/**
 * Turn a screenshot into a card face.
 *
 * The cutting happens here rather than on the server: the browser already
 * decodes any image format that can be picked, and a canvas gives the pixels
 * and the re-encode for free — so the server never needs an image library, and
 * what uploads is exactly what the preview showed.
 *
 * Where to cut comes from the screenshot's size. A given phone puts the card in
 * the same place every time, so matching the screen and stamping out its known
 * rectangle beats reading the edges of art that has never been seen — a card
 * whose top meets the backdrop has no top edge to find. Reading the edges is
 * kept for pictures no preset covers.
 */
async function cropToCard(
  file: File
): Promise<{ blob: Blob; source: { width: number; height: number }; from: string }> {
  const bitmap = await createImageBitmap(file);
  // close() leaves width and height reading zero, so take them first.
  const width = bitmap.width;
  const height = bitmap.height;

  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const ctx = full.getContext("2d");
  if (!ctx) throw new Error("This browser would not give a canvas to draw on.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const preset = presetFor(width, height);
  let box: Rect | null = preset && fromFractions(preset.crop, width, height);
  let from = preset ? `${preset.name} preset` : "";

  if (!box) {
    const diff = differenceMap(ctx.getImageData(0, 0, width, height).data, width, height);
    box = diff && detectCardRect(diff, width, height);
    from = box ? "edges" : "whole image";
  }
  // No preset and nothing card-shaped — an already-cropped image, or a photo.
  // Keep the whole thing; the preview shows what it decided.
  const cut = box ?? { x: 0, y: 0, width, height };

  const out = document.createElement("canvas");
  out.width = cut.width;
  out.height = cut.height;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("This browser would not give a canvas to draw on.");

  // Round the corners into the image itself. It cannot be done in CSS here:
  // globals.css squares off every border-radius in the app, which is the
  // terminal look everything else wants. A rounded clip leaves the corners
  // transparent, and PNG keeps that.
  const radius = cornerRadiusFor(cut.width);
  if (radius > 0 && typeof outCtx.roundRect === "function") {
    outCtx.beginPath();
    outCtx.roundRect(0, 0, cut.width, cut.height, radius);
    outCtx.clip();
  }
  outCtx.drawImage(full, cut.x, cut.y, cut.width, cut.height, 0, 0, cut.width, cut.height);

  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
  if (!blob) throw new Error("The image could not be re-encoded.");
  return { blob, source: { width, height }, from };
}

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
  const [preview, setPreview] = useState<
    { url: string; blob: Blob; source: { width: number; height: number }; from: string } | null
  >(null);

  function clearPreview() {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const out = await cropToCard(file);
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p.url);
        return { url: URL.createObjectURL(out.blob), ...out };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = ""; // so the same file can be picked again
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/user-cards/${cardId}/art`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: preview.blob,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to save the image");
      clearPreview();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the image");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this card's image?")) return;
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

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {/* On the art's top-right corner — the parent is `relative group`. Out of
          sight until the card is hovered, except on touch screens, which have
          no hover to reveal it. */}
      <button
        type="button"
        onClick={hasArt ? remove : () => input.current?.click()}
        disabled={busy}
        aria-label={hasArt ? "Remove image" : "Add image"}
        title={hasArt ? "Remove image" : "Add image"}
        className="absolute left-[74px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[11px] leading-none text-white opacity-0 transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 [@media(hover:none)]:opacity-100"
      >
        {busy && !preview ? "…" : hasArt ? "×" : "+"}
      </button>

      {preview && (
        <div className="mt-1.5 flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="The card as it will be saved" className="w-[92px] rounded-md" />
          <span className="text-[10px] text-black/45 dark:text-white/45">
            {preview.source.width}×{preview.source.height} · cut by {preview.from}
          </span>
          <div className="flex items-center gap-2">
            {/* Nothing is stored until this is pressed, so it reads as the
                action rather than as another quiet link beside Cancel. */}
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save image"}
            </button>
            <button type="button" onClick={clearPreview} disabled={busy} className={link}>
              Cancel
            </button>
          </div>
          <span className="text-[10px] text-amber-700 dark:text-amber-400">Not saved yet</span>
        </div>
      )}

      {error && <span className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">{error}</span>}
    </>
  );
}
