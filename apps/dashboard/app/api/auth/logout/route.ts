import { NextResponse } from "next/server";
import { TOKEN_COOKIE } from "@/lib/api";

function safeNext(value: string | null): string {
  // Only allow internal paths; never redirect to another origin.
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/login";
  return value;
}

/** Browser navigation: clear the session cookie and continue to the login page. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), request.url));
  response.cookies.set({ name: TOKEN_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: TOKEN_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
