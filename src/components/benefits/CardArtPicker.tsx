"use client";

import { useEffect, useRef, useState } from "react";
import {
  CROP_KEY,
  detectCardRect,
  differenceMap,
  fromFractions,
  isCropFractions,
  toFractions,
  type CropFractions,
} from "@/lib/card-crop";
import { loadSynced, pushSynced } from "@/lib/ui-state";

/**
 * Turn a screenshot into a card face.
 *
 * The cropping happens here rather than on the server: the browser already
 * decodes any image format the user can pick, and a canvas gives the pixels
 * and the re-encode for free — so the server never needs an image library, and
 * what gets uploaded is exactly what was shown in the preview.
 */
async function cropToCard(
  file: File,
  remembered: CropFractions | null
): Promise<{ blob: Blob; used: "remembered" | "detected" | "whole"; crop: CropFractions | null }> {
  const bitmap = await createImageBitmap(file);
  // Kept aside: close() releases the bitmap and leaves its width and height
  // reading zero, which silently turned the remembered crop into nothing.
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const full = document.createElement("canvas");
  full.width = srcW;
  full.height = srcH;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) throw new Error("This browser would not give a canvas to draw on.");
  fullCtx.drawImage(bitmap, 0, 0);

  const { data } = fullCtx.getImageData(0, 0, srcW, srcH);
  // A crop that was right before is right again: Wallet puts the card in the
  // same place on every screenshot from the same phone, and that beats reading
  // the edges of art it has never seen.
  const saved = remembered && fromFractions(remembered, srcW, srcH);
  const diff = saved ? null : differenceMap(data, srcW, srcH);
  const rect = diff && detectCardRect(diff, srcW, srcH);
  // Nothing card-shaped found — an image that is already cropped, or a photo
  // rather than a screenshot. Keep the whole thing: the preview shows what it
  // decided, so a wrong guess is visible before it is saved.
  const box = saved ?? rect ?? { x: 0, y: 0, width: srcW, height: srcH };
  const used = saved ? "remembered" : rect ? "detected" : "whole";

  const out = document.createElement("canvas");
  out.width = box.width;
  out.height = box.height;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("This browser would not give a canvas to draw on.");
  outCtx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
  if (!blob) throw new Error("The image could not be re-encoded.");
  return { blob, used, crop: toFractions(box, srcW, srcH) };
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
    { url: string; blob: Blob; used: "remembered" | "detected" | "whole"; crop: CropFractions | null } | null
  >(null);
  // The crop last saved, reused for the next screenshot. Held in a ref as well
  // so pick() reads the current value rather than the one captured at render.
  const [remembered, setRemembered] = useState<CropFractions | null>(null);
  const rememberedRef = useRef<CropFractions | null>(null);
  // The picked file, so the crop can be redone the other way without asking
  // for it again.
  const source = useRef<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSynced(CROP_KEY);
      if (cancelled || !isCropFractions(stored)) return;
      rememberedRef.current = stored;
      setRemembered(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function clearPreview() {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  }

  async function crop(file: File, useRemembered: boolean) {
    setError(null);
    setBusy(true);
    try {
      const out = await cropToCard(file, useRemembered ? rememberedRef.current : null);
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p.url);
        return { url: URL.createObjectURL(out.blob), ...out };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    source.current = file;
    await crop(file, true);
    if (input.current) input.current.value = ""; // so the same file can be picked again
  }

  // Read this screenshot's own edges instead of reusing the saved position —
  // for this picture only. The saved position stays, so the choice is
  // reversible; saving replaces it with whatever was actually used.
  function detectInstead() {
    if (source.current) void crop(source.current, false);
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
      // Whatever was right for this screenshot is the starting point for the
      // next one, since they come off the same phone and the same screen.
      if (preview.crop) {
        rememberedRef.current = preview.crop;
        setRemembered(preview.crop);
        pushSynced(CROP_KEY, preview.crop);
      }
      clearPreview();
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

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="The card as it will be saved" className="w-[92px] rounded-md" />
          <span className="text-[10px] text-black/45 dark:text-white/45">
            {preview.used === "remembered"
              ? "Same position as the last card"
              : preview.used === "detected"
                ? "Cropped to the card"
                : "No card found — using the whole image"}
          </span>

          {/* Wallet puts the card in the same place every time, so the position
              that worked is reused. When a screenshot is framed differently,
              this drops back to reading the edges. */}
          {preview.used === "remembered" ? (
            <button type="button" onClick={detectInstead} disabled={busy} className={link}>
              Find the edges instead
            </button>
          ) : (
            remembered && (
              <button
                type="button"
                onClick={() => source.current && crop(source.current, true)}
                disabled={busy}
                className={link}
              >
                Use the saved position
              </button>
            )
          )}

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
