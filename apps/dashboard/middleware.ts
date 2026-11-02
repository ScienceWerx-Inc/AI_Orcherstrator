import { NextResponse, type NextRequest } from "next/server";

const TOKEN_COOKIE = "ai_mw_token";

/**
 * Cheap gate only: it checks that a session cookie exists. The gateway is the
 * authority for token validity; any expired token yields a 401 from the API and
 * the server components redirect back here.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(TOKEN_COOKIE)?.value);

  if (pathname === "/login") {
    // Do not bounce back to "/" just because a cookie exists: if the token is
    // stale (e.g. issued against a different database), "/" redirects here
    // again and the browser gets an infinite redirect loop. The login page is
    // always reachable; a successful login replaces the cookie.
    return NextResponse.next();
  }

  if (!hasToken) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
