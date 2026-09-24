import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteArt, saveArt } from "@/lib/card-art-store";

// A card face, already cropped and re-encoded as PNG by the browser. Sized for
// a screenshot rather than a photo library: anything larger is a mistake.
const MAX_BYTES = 4 * 1024 * 1024;

// PUT /api/user-cards/:id/art — body is the raw PNG.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const card = await prisma.userCard.findUnique({ where: { id } });
    if (!card) return NextResponse.json({ error: "No such card" }, { status: 404 });

    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) return NextResponse.json({ error: "Empty image" }, { status: 400 });
    if (bytes.length > MAX_BYTES)
      return NextResponse.json({ error: "Image is too large" }, { status: 413 });
    // The PNG signature, so a mislabelled body fails here rather than as a
    // broken image in every card list from now on.
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!PNG.every((b, i) => bytes[i] === b))
      return NextResponse.json({ error: "Not a PNG" }, { status: 415 });

    const artFile = await saveArt(id, bytes);
    await prisma.userCard.update({ where: { id }, data: { artFile } });
    return NextResponse.json({ ok: true, artFile });
  } catch (err) {
    console.error("[card art PUT]", err);
    return NextResponse.json({ error: "Failed to save the image" }, { status: 500 });
  }
}

// DELETE /api/user-cards/:id/art — back to the placeholder face.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const card = await prisma.userCard.findUnique({ where: { id } });
    if (!card) return NextResponse.json({ error: "No such card" }, { status: 404 });
    if (card.artFile) await deleteArt(card.artFile);
    await prisma.userCard.update({ where: { id }, data: { artFile: null } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[card art DELETE]", err);
    return NextResponse.json({ error: "Failed to remove the image" }, { status: 500 });
  }
}
