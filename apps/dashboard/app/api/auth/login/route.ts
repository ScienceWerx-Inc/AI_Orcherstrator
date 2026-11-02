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
    response.cookies.set({
      name: TOKEN_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
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
