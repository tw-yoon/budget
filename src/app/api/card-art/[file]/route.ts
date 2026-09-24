import { NextResponse } from "next/server";
import { readArt } from "@/lib/card-art-store";

// GET /api/card-art/:file — the stored image. Served from data/ rather than
// public/ so card faces sit with the rest of what the app writes, and are
// gitignored with it.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const bytes = await readArt(file);
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      // The name changes only when the card does, and the bytes behind it can
      // be replaced, so revalidate rather than cache it for a year.
      "Cache-Control": "no-cache",
    },
  });
}
