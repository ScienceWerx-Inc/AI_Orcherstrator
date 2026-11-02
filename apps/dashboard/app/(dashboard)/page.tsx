import Link from "next/link";
import { api } from "@/lib/api";
import { BreakdownChart, SpendChart, TrafficChart } from "@/components/charts";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Progress,
  RangeTabs,
  Stat,
  StatusBadge,
  buttonClasses,
  tableClasses,
} from "@/components/ui";
import { compactNumber, formatMs, formatUsd, percent } from "@/lib/utils";

export const dynamic = "force-dynamic";

function parseDays(value: string | undefined): number {
  const parsed = Number(value);
  return [7, 30, 90].includes(parsed) ? parsed : 30;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const days = parseDays(searchParams.days);

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
      api.breakdown(days, "model"),
      api.providersComparison(days),
      api.latency(days),
      api.errors(days),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Overview" description="Platform health and usage for your organization." />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  const data = overview.data;
  const topProviders = providerStats.data.data.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Usage, spend and reliability across all projects · last ${days} days`}
      >
        <RangeTabs days={days} basePath="/" />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Requests"
          value={compactNumber(data.requests.total)}
          hint={`${data.requests.failed} failed · ${percent(data.requests.errorRatePct)} error rate`}
          tone={data.requests.errorRatePct > 5 ? "bad" : "default"}
        />
        <Stat
          label="Spend"
          value={formatUsd(data.spendUsd)}
          hint={`${formatUsd(data.estimatedSavingsUsd)} saved vs. highest-cost baseline`}
          tone="good"
        />
        <Stat
          label="Tokens"
          value={compactNumber(data.tokens.total)}
          hint={`${compactNumber(data.tokens.input)} in · ${compactNumber(data.tokens.output)} out`}
        />
        <Stat
          label="Latency"
          value={formatMs(data.latency.avgMs)}
          hint={`p95 ${formatMs(data.latency.p95Ms)}${
            data.latency.avgTtftMs ? ` · TTFT ${formatMs(data.latency.avgTtftMs)}` : ""
          }`}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Request volume"
            description="Successful and failed requests per bucket"
            action={
              <Badge tone={data.requests.failed > 0 ? "amber" : "emerald"}>
                {data.requests.failed > 0 ? `${data.requests.failed} failures` : "all healthy"}
              </Badge>
            }
          />
          <CardBody>
            <TrafficChart data={timeseries.data.data} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Spend" description="Billed cost per bucket" />
          <CardBody>
            <SpendChart data={timeseries.data.data} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Top models" description="By token volume" />
          <CardBody>
            {breakdown.data.data.length === 0 ? (
              <EmptyState title="No model traffic yet" />
            ) : (
              <BreakdownChart data={breakdown.data.data} />
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Provider comparison"
            description="Volume, cost and reliability by provider"
            action={
              <Link href="/providers" className={buttonClasses.ghost}>
                Manage
              </Link>
            }
          />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Provider</th>
                  <th className={tableClasses.th}>Requests</th>
                  <th className={tableClasses.th}>Tokens</th>
                  <th className={tableClasses.th}>Cost</th>
                  <th className={tableClasses.th}>Avg latency</th>
                  <th className={tableClasses.th}>Errors</th>
                </tr>
              </thead>
              <tbody>
                {topProviders.map((provider) => (
                  <tr key={provider.providerId} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="font-medium text-slate-200">{provider.name}</span>
                      <span className="ml-2 text-[11px] text-slate-500">{provider.type}</span>
                    </td>
                    <td className={tableClasses.td}>{compactNumber(provider.requests)}</td>
                    <td className={tableClasses.td}>{compactNumber(provider.tokens)}</td>
                    <td className={tableClasses.td}>{formatUsd(provider.costUsd)}</td>
                    <td className={tableClasses.td}>{formatMs(provider.avgLatencyMs)}</td>
                    <td className={tableClasses.td}>
                      <Badge tone={provider.errorRatePct > 5 ? "rose" : "slate"}>
                        {percent(provider.errorRatePct)}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {topProviders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={tableClasses.td}>
                      No provider traffic in this window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Reliability" description="Latency distribution and error codes" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ["p50", latency.data.p50Ms],
                ["p95", latency.data.p95Ms],
                ["p99", latency.data.p99Ms],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-white/5 px-2 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-medium text-slate-200">{formatMs(Number(value))}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {errors.data.byCode.length === 0 ? (
                <p className="text-xs text-slate-500">No errors recorded in this window.</p>
              ) : (
                errors.data.byCode.slice(0, 5).map((entry) => (
                  <div key={entry.code} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-400">{entry.code}</span>
                    <span className="text-slate-300">{entry.count}</span>
                  </div>
                ))
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Self-hosted allocation" description="GPU cost recovered from measured latency" />
          <CardBody>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Requests", compactNumber(data.selfHosted.requests)],
                ["Tokens", compactNumber(data.selfHosted.tokens)],
                ["GPU time", formatMs(data.selfHosted.gpuMs)],
                ["GPU cost", formatUsd(data.selfHosted.costUsd)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-200">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Provider availability</span>
                <span>
                  {data.providers.filter((provider) => provider.available).length}/
                  {data.providers.length} healthy
                </span>
              </div>
              <Progress
                value={
                  data.providers.length > 0
                    ? (data.providers.filter((provider) => provider.available).length /
                        data.providers.length) *
                      100
                    : 0
                }
                tone="emerald"
              />
              <div className="flex flex-wrap gap-2 pt-2">
                {data.providers.map((provider) => (
                  <span key={provider.id} className="inline-flex items-center gap-1.5">
                    <StatusBadge value={provider.status} />
                    <span className="text-[11px] text-slate-500">{provider.name}</span>
                  </span>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
