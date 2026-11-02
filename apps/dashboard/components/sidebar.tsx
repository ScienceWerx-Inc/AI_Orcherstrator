"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Boxes,
  Gauge,
  Layers,
  LayoutDashboard,
  LogOut,
  Network,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClasses } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/projects", label: "Projects & keys", icon: Boxes },
  { href: "/analytics", label: "Analytics", icon: Gauge },
  { href: "/usage", label: "Request log", icon: Activity },
  { href: "/models", label: "Model registry", icon: Layers },
  { href: "/providers", label: "Providers", icon: Network },
  { href: "/routing", label: "Routing policies", icon: Waypoints },
  { href: "/infrastructure", label: "Infrastructure", icon: SlidersHorizontal },
  { href: "/settings", label: "Budgets & alerts", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30">
        <ShieldCheck size={17} />
      </span>
      <span>
        <span className="block text-sm font-semibold leading-tight text-slate-100">
          AI Middleware
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-500">
          control plane
        </span>
      </span>
    </Link>
  );
}

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: string; orgName: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/10 bg-surface/80 backdrop-blur lg:flex">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  active
                    ? "bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-400/20"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-xs font-medium text-slate-300">{user.orgName}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {user.name} · {user.role.toLowerCase()}
          </p>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className={cn(buttonClasses.ghost, "mt-2 w-full justify-start px-1 text-xs")}
          >
            <LogOut size={14} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="sticky top-0 z-20 border-b border-white/10 bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className={buttonClasses.ghost}
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition",
                  active ? "bg-sky-500/15 text-sky-200" : "text-slate-400",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
