import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/access";

// POST /api/access/signout — clears this browser's sign-in cookie.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACCESS_COOKIE);
  return res;
}
