import { NextResponse } from "next/server";
import { GatewayError, TOKEN_COOKIE, login } from "@/lib/api";

export async function POST(request: Request) {
  let payload: { email?: string; password?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.email || !payload.password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  try {
    const token = await login(payload.email, payload.password);
    const response = NextResponse.json({ ok: true });
    // Only flag the cookie Secure on an actual HTTPS request. `next start` sets
    // NODE_ENV=production, but a local dashboard is served over http:// — a
    // Secure cookie there is rejected by several browsers (and always rejected
    // when the app is opened via a LAN IP), which makes login appear to bounce
    // straight back to /login.
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const secure = (forwardedProto ?? new URL(request.url).protocol.replace(":", "")) === "https";
    response.cookies.set({
      name: TOKEN_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch (error) {
    if (error instanceof GatewayError) {
      return NextResponse.json(
        { error: error.status === 401 ? "Invalid email or password" : error.message },
        { status: error.status === 401 ? 401 : error.status },
      );
    }
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
