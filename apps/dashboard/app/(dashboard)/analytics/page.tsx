import Link from "next/link";
import { api } from "@/lib/api";
import { SpendChart, TrafficChart } from "@/components/charts";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorBanner,
  PageHeader,
  Progress,
  RangeTabs,
  Stat,
  tableClasses,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { compactNumber, formatMs, formatUsd, percent } from "@/lib/utils";

export const dynamic = "force-dynamic";

const BREAKDOWNS = ["model", "provider", "project", "modality"] as const;
type BreakdownBy = (typeof BREAKDOWNS)[number];

function parseDays(value: string | undefined): number {
  const parsed = Number(value);
  return [7, 30, 90].includes(parsed) ? parsed : 30;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { days?: string; by?: string };
}) {
  const days = parseDays(searchParams.days);
  const by = (BREAKDOWNS as readonly string[]).includes(searchParams.by ?? "")
    ? (searchParams.by as BreakdownBy)
    : "model";

  let overview;
  let timeseries;
  let breakdown;
  let providerStats;
  let latency;
  let errors;
  try {
    [overview, timeseries, breakdown, providerStats, latency, errors] = await Promise.all([
      api.overview(days),
      api.timeseries(days),
      api.breakdown(days, by),
      api.providersComparison(days),
      api.latency(days),
      api.errors(days),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Analytics" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  const data = overview.data;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Metered usage across providers, models and projects · last ${days} days`}
      >
        <RangeTabs days={days} basePath="/analytics" />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Requests" value={compactNumber(data.requests.total)} hint={`${data.requests.failed} failed`} />
        <Stat
          label="Error rate"
          value={percent(data.requests.errorRatePct)}
          tone={data.requests.errorRatePct > 5 ? "bad" : "good"}
          hint={`${data.requests.failed} of ${data.requests.total}`}
        />
        <Stat label="Spend" value={formatUsd(data.spendUsd)} hint="Billed inference + GPU allocation" tone="good" />
        <Stat
          label="Savings"
          value={formatUsd(data.estimatedSavingsUsd)}
          hint="vs. highest-cost eligible candidate"
        />
        <Stat label="Avg latency" value={formatMs(data.latency.avgMs)} hint={`p95 ${formatMs(data.latency.p95Ms)}`} />
        <Stat label="Tokens" value={compactNumber(data.tokens.total)} hint={`${compactNumber(data.tokens.input)} prompt`} />
        <Stat
          label="Self-hosted cost"
          value={formatUsd(data.selfHosted.costUsd)}
          hint={`${formatMs(data.selfHosted.gpuMs)} GPU time`}
        />
        <Stat
          label="Projects"
          value={`${data.projects.active}/${data.projects.total}`}
          hint="active / total"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Requests and errors" description="Volume per time bucket" />
          <CardBody>
            <TrafficChart data={timeseries.data.data} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Spend" description="Cost per time bucket" />
          <CardBody>
            <SpendChart data={timeseries.data.data} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Breakdown"
            description="Token volume and cost share"
            action={
              <div className="flex flex-wrap gap-1">
                {BREAKDOWNS.map((option) => (
                  <Link
                    key={option}
                    href={`/analytics?days=${days}&by=${option}`}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] capitalize transition",
                      option === by
                        ? "bg-sky-500/20 text-sky-200"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                    )}
                  >
                    {option}
                  </Link>
                ))}
              </div>
            }
          />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Key</th>
                  <th className={tableClasses.th}>Requests</th>
                  <th className={tableClasses.th}>Tokens</th>
                  <th className={tableClasses.th}>Cost</th>
                  <th className={tableClasses.th}>Share</th>
                  <th className={tableClasses.th}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.data.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={tableClasses.td}>
                      No usage recorded.
                    </td>
                  </tr>
                ) : (
                  breakdown.data.data.map((row) => (
                    <tr key={row.key} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <span className="text-slate-200">{row.label}</span>
                      </td>
                      <td className={tableClasses.td}>{compactNumber(row.requests)}</td>
                      <td className={tableClasses.td}>{compactNumber(row.tokens)}</td>
                      <td className={tableClasses.td}>{formatUsd(row.costUsd)}</td>
                      <td className={tableClasses.td}>
                        <div className="flex items-center gap-2">
                          <div className="w-16">
                            <Progress value={row.sharePct} />
                          </div>
                          <span className="text-[11px] text-slate-500">{percent(row.sharePct)}</span>
                        </div>
                      </td>
                      <td className={tableClasses.td}>{formatMs(row.avgLatencyMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Provider performance" description="Volume, cost and error rate" />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Provider</th>
                  <th className={tableClasses.th}>Requests</th>
                  <th className={tableClasses.th}>Cost</th>
                  <th className={tableClasses.th}>Latency</th>
                  <th className={tableClasses.th}>Errors</th>
                </tr>
              </thead>
              <tbody>
                {providerStats.data.data.map((row) => (
                  <tr key={row.providerId} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="text-slate-200">{row.name}</span>
                      <p className="text-[11px] text-slate-500">{row.type.toLowerCase()}</p>
                    </td>
                    <td className={tableClasses.td}>{compactNumber(row.requests)}</td>
                    <td className={tableClasses.td}>{formatUsd(row.costUsd)}</td>
                    <td className={tableClasses.td}>{formatMs(row.avgLatencyMs)}</td>
                    <td className={tableClasses.td}>
                      <Badge tone={row.errorRatePct > 5 ? "rose" : "slate"}>
                        {percent(row.errorRatePct)}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {providerStats.data.data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={tableClasses.td}>
                      No provider usage in this window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Latency distribution" description={`${latency.data.samples} measured requests`} />
          <CardBody className="space-y-3">
            {[
              ["p50", latency.data.p50Ms],
              ["p75", latency.data.p75Ms],
              ["p90", latency.data.p90Ms],
              ["p95", latency.data.p95Ms],
              ["p99", latency.data.p99Ms],
            ].map(([label, value]) => {
              const ms = Number(value);
              const max = Math.max(latency.data.p99Ms, 1);
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className="w-8 text-[11px] uppercase text-slate-500">{label}</span>
                  <div className="flex-1">
                    <Progress value={(ms / max) * 100} tone={label === "p99" ? "amber" : "blue"} />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-slate-300">
                    {formatMs(ms)}
                  </span>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Errors" description="Failure codes and HTTP statuses" />
          <CardBody className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">By code</p>
              {errors.data.byCode.length === 0 ? (
                <p className="text-xs text-slate-500">No errors recorded.</p>
              ) : (
                <div className="space-y-2">
                  {errors.data.byCode.map((entry) => (
                    <div key={entry.code} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-400">{entry.code}</span>
                      <span className="text-slate-300">{entry.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">By status</p>
              {errors.data.byStatus.length === 0 ? (
                <p className="text-xs text-slate-500">No failed requests.</p>
              ) : (
                <div className="space-y-2">
                  {errors.data.byStatus.map((entry) => (
                    <div key={entry.status} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{entry.status.toLowerCase()}</span>
                      <span className="text-slate-300">{entry.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
