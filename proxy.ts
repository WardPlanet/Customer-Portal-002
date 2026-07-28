import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "pdds_auth";

export function proxy(request: NextRequest) {
  const cookie = request.cookies.get(COOKIE_NAME);
  if (!cookie?.value) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
