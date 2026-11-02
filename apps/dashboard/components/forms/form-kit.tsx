"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClasses, fieldClasses, labelClasses, NoticeBanner } from "../ui";

export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<string | void>) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  }

  return { pending, error, notice, run, setError, setNotice };
}

export function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <NoticeBanner tone="emerald">
          <span className="text-xs">{notice}</span>
        </NoticeBanner>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className={labelClasses}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function SubmitButton({
  pending,
  children,
  className,
}: {
  pending: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="submit" disabled={pending} className={className ?? buttonClasses.primary}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-surface-raised accent-sky-500"
      />
      {label}
    </label>
  );
}

export function CheckboxGroup({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string, checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-surface-raised/60 p-3 sm:grid-cols-3">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(event) => onToggle(option.value, event.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-surface-raised accent-sky-500"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function Collapsible({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-white/10 bg-surface-card/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-slate-300 transition hover:bg-white/[0.03]">
        <span>{summary}</span>
        <span className="text-xs text-slate-500 group-open:hidden">open</span>
        <span className="hidden text-xs text-slate-500 group-open:inline">close</span>
      </summary>
      <div className="border-t border-white/10 p-4">{children}</div>
    </details>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className={buttonClasses.secondary}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function inputClasses() {
  return fieldClasses;
}
