"use client";

import { useRef, useState } from "react";
import { detectCardRect, foregroundMask } from "@/lib/card-crop";

/**
 * Turn a screenshot into a card face.
 *
 * The cropping happens here rather than on the server: the browser already
 * decodes any image format the user can pick, and a canvas gives the pixels
 * and the re-encode for free — so the server never needs an image library, and
 * what gets uploaded is exactly what was shown in the preview.
 */
async function cropToCard(file: File): Promise<{ blob: Blob; detected: boolean }> {
  const bitmap = await createImageBitmap(file);
  const full = document.createElement("canvas");
  full.width = bitmap.width;
  full.height = bitmap.height;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) throw new Error("This browser would not give a canvas to draw on.");
  fullCtx.drawImage(bitmap, 0, 0);

  const { data } = fullCtx.getImageData(0, 0, bitmap.width, bitmap.height);
  const mask = foregroundMask(data, bitmap.width, bitmap.height);
  const rect = mask && detectCardRect(mask, bitmap.width, bitmap.height);
  // Nothing card-shaped found — an image that is already cropped, or a photo
  // rather than a screenshot. Keep the whole thing: the preview shows what it
  // decided, so a wrong guess is visible before it is saved.
  const box = rect ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };

  const out = document.createElement("canvas");
  out.width = box.width;
  out.height = box.height;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("This browser would not give a canvas to draw on.");
  outCtx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
  if (!blob) throw new Error("The image could not be re-encoded.");
  return { blob, detected: rect !== null };
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
  const [preview, setPreview] = useState<{ url: string; blob: Blob; detected: boolean } | null>(null);

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
      const { blob, detected } = await cropToCard(file);
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p.url);
        return { url: URL.createObjectURL(blob), blob, detected };
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
            {preview.detected ? "Cropped to the card" : "No card found — using the whole image"}
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
