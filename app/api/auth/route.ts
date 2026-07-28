import { NextRequest, NextResponse } from "next/server";

const PASSPHRASE = process.env.PORTAL_PASSPHRASE ?? "PlanetDDS";
const COOKIE_NAME = "pdds_auth";
const FIVE_DAYS = 5 * 24 * 60 * 60;

export async function POST(request: NextRequest) {
  let body: { passphrase?: string };
  try { body = await request.json() }
  catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }) }

  if (body.passphrase !== PASSPHRASE)
    return NextResponse.json({ error: "Incorrect passphrase" }, { status: 401 });

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FIVE_DAYS,
  });
  return response;
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
