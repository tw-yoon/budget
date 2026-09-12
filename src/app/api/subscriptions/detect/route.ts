import { NextResponse } from "next/server";
import { detectSubscriptions } from "@/services/subscriptions.service";

// POST /api/subscriptions/detect — scan Plaid recurring streams for subscriptions.
export async function POST() {
  try {
    const result = await detectSubscriptions();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[subscriptions detect]", err);
    return NextResponse.json({ error: "Detection failed" }, { status: 500 });
  }
}
