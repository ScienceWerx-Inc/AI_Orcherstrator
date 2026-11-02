export function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcMonth(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function budgetPeriodStart(period: "DAILY" | "MONTHLY", now = new Date()): Date {
  return period === "DAILY" ? startOfUtcDay(now) : startOfUtcMonth(now);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
