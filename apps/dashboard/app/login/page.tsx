import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next =
    typeof searchParams.next === "string" && searchParams.next.startsWith("/")
      ? searchParams.next
      : "/";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30">
            <ShieldCheck size={24} />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-100">
            AI Middleware control plane
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Multi-tenant gateway operations and metering
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-6 shadow-card backdrop-blur">
          <LoginForm next={next} showDemo={process.env.NODE_ENV !== "production"} />
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-600">
          Sessions are stored in an httpOnly cookie and verified by the gateway on every request.
        </p>
        <p className="mt-2 text-center text-[11px] text-slate-600">
          Stuck on this page?{" "}
          <a
            href="/api/auth/logout?next=/login"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            Clear the old session
          </a>{" "}
          and sign in again.
        </p>
      </div>
    </main>
  );
}
