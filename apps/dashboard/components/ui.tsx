import Link from "next/link";
import { cn } from "@/lib/utils";

/* ───────────────────────────────── layout ────────────────────────────────── */

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-white/10 bg-surface-card/80 shadow-card backdrop-blur",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-slate-100",
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-rose-300",
  }[tone];

  return (
    <Card className="p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </Card>
  );
}

/* ───────────────────────────────── badges ────────────────────────────────── */

export type Tone = "slate" | "blue" | "emerald" | "amber" | "rose" | "violet";

const TONE_CLASSES: Record<Tone, string> = {
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
};

export function Badge({
  children,
  tone = "slate",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  const value = status.toUpperCase();
  if (["ACTIVE", "SUCCEEDED", "CLOSED", "RESOLVED", "HEALTHY"].includes(value)) return "emerald";
  if (["DEGRADED", "HALF_OPEN", "SOFT_LIMIT", "ACKNOWLEDGED", "WARNING"].includes(value)) return "amber";
  if (["FAILED", "OPEN", "OFFLINE", "DISABLED", "REVOKED", "SUSPENDED", "CRITICAL"].includes(value)) return "rose";
  if (["RUNNING", "QUEUED", "RETRYING", "INFO"].includes(value)) return "blue";
  return "slate";
}

export function StatusBadge({ value }: { value: string }) {
  return <Badge tone={statusTone(value)}>{value.replaceAll("_", " ").toLowerCase()}</Badge>;
}

/* ───────────────────────────────── surfaces ──────────────────────────────── */

export const tableClasses = {
  wrapper: "overflow-x-auto",
  table: "w-full border-collapse text-sm",
  head: "text-left text-[11px] uppercase tracking-wider text-slate-500",
  th: "whitespace-nowrap border-b border-white/10 px-5 py-3 font-medium",
  td: "border-b border-white/5 px-5 py-3 align-middle text-slate-300",
  row: "transition-colors hover:bg-white/[0.03]",
};

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description ? <p className="max-w-md text-xs text-slate-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function Progress({
  value,
  tone = "blue",
}: {
  value: number;
  tone?: "blue" | "emerald" | "amber" | "rose";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = {
    blue: "bg-sky-400",
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
  }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      {message}
    </div>
  );
}

export function NoticeBanner({
  tone = "emerald",
  children,
}: {
  tone?: "emerald" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const classes = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    blue: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  }[tone];
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", classes)}>{children}</div>;
}

/* ───────────────────────────────── controls ──────────────────────────────── */

export const buttonClasses = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50",
};

export const fieldClasses =
  "w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20";

export const labelClasses =
  "mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500";

export function RangeTabs({ days, basePath }: { days: number; basePath: string }) {
  const options = [7, 30, 90];
  return (
    <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
      {options.map((option) => (
        <Link
          key={option}
          href={`${basePath}?days=${option}`}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition",
            option === days
              ? "bg-sky-500/20 text-sky-200"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          {option}d
        </Link>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  totalPages: number;
  total: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
}) {
  const makeHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value) params.set(key, value);
    }
    params.set("page", String(target));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-slate-500">
      <span>
        Page {page} of {totalPages} · {total.toLocaleString()} records
      </span>
      <div className="flex items-center gap-2">
        <Link
          aria-disabled={page <= 1}
          href={page <= 1 ? "#" : makeHref(page - 1)}
          className={cn(buttonClasses.secondary, "px-2.5 py-1 text-xs", page <= 1 && "pointer-events-none opacity-40")}
        >
          Previous
        </Link>
        <Link
          aria-disabled={page >= totalPages}
          href={page >= totalPages ? "#" : makeHref(page + 1)}
          className={cn(buttonClasses.secondary, "px-2.5 py-1 text-xs", page >= totalPages && "pointer-events-none opacity-40")}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
