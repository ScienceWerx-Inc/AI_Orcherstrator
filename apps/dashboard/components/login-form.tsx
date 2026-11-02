"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClasses, fieldClasses, labelClasses } from "./ui";

export function LoginForm({ next, showDemo }: { next: string; showDemo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Unable to sign in");
        return;
      }
      router.replace(next || "/");
      router.refresh();
    } catch {
      setError("Unable to reach the dashboard API");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className={labelClasses}>
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClasses}
          placeholder="admin@example.com"
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClasses}>
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClasses}
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={loading} className={`${buttonClasses.primary} w-full`}>
        {loading ? "Signing in…" : "Sign in"}
      </button>

      {showDemo ? (
        <p className="text-center text-[11px] text-slate-500">
          Local seed login: <span className="font-mono">admin@local.dev</span> /{" "}
          <span className="font-mono">admin12345</span>
        </p>
      ) : null}
    </form>
  );
}
