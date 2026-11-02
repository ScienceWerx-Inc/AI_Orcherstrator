import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { GATEWAY_URL, TOKEN_COOKIE } from "@/lib/api";

export const dynamic = "force-dynamic";

const FORWARDED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

async function proxy(request: Request, path: string[]) {
  if (!FORWARDED_METHODS.has(request.method)) {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const token = cookies().get(TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const target = `${GATEWAY_URL}/admin/${path.join("/")}${url.search}`;
  const hasBody = !["GET", "DELETE"].includes(request.method);
  const body = hasBody ? await request.text() : undefined;

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text();
    return new NextResponse(text || null, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Gateway unreachable", code: "gateway_unreachable" } },
      { status: 503 },
    );
  }
}

export async function GET(request: Request, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}

export async function POST(request: Request, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}

export async function PATCH(request: Request, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}

export async function PUT(request: Request, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}

export async function DELETE(request: Request, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path);
}
