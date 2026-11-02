import { api } from "@/lib/api";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorBanner,
  NoticeBanner,
  PageHeader,
  Stat,
  StatusBadge,
  tableClasses,
} from "@/components/ui";
import { compactNumber, formatMs, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InfrastructurePage() {
  let infrastructure;
  try {
    infrastructure = await api.infrastructure();
  } catch (error) {
    return (
      <>
        <PageHeader title="Infrastructure" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  const data = infrastructure.data;
  const selfHosted = data.models.filter((model) => model.deploymentKind === "SELF_HOSTED");

  return (
    <>
      <PageHeader
        title="Infrastructure"
        description="Live capacity, circuit state and runtime health. Metrics come from the gateway itself — nothing is simulated."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Requests / second" value={String(data.requestsPerSecondLast5m)} hint="rolling 5 minute average" />
        <Stat label="Avg latency" value={formatMs(data.avgLatencyMsLast5m)} hint="rolling 5 minutes" />
        <Stat label="Queue depth" value={compactNumber(data.queueDepth)} hint="queued + running + retrying jobs" />
        <Stat label="Providers" value={String(data.providers.length)} hint="configured for this organisation" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Provider circuits" description="Opened by consecutive failures; reset after cooldown" />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Provider</th>
                  <th className={tableClasses.th}>Status</th>
                  <th className={tableClasses.th}>Circuit</th>
                  <th className={tableClasses.th}>Failures</th>
                  <th className={tableClasses.th}>Retry after</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map((provider) => (
                  <tr key={provider.id} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="text-slate-200">{provider.name}</span>
                      <p className="text-[11px] text-slate-500">{provider.type.toLowerCase()}</p>
                    </td>
                    <td className={tableClasses.td}>
                      <StatusBadge value={provider.status} />
                    </td>
                    <td className={tableClasses.td}>
                      <Badge tone={provider.circuit?.state === "CLOSED" ? "emerald" : "amber"}>
                        {(provider.circuit?.state ?? "UNKNOWN").toLowerCase().replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className={tableClasses.td}>{provider.circuit?.failures ?? 0}</td>
                    <td className={tableClasses.td}>
                      {provider.circuit?.retryAfterMs
                        ? formatMs(provider.circuit.retryAfterMs)
                        : "—"}
                    </td>
                  </tr>
                ))}
                {data.providers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={tableClasses.td}>
                      No providers configured.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Runtime notes" description="Capabilities that are not yet enabled are reported as such" />
          <CardBody className="space-y-3">
            <NoticeBanner tone="amber">
              <span className="text-xs">GPU metrics: {data.gpuMetrics.reason}</span>
            </NoticeBanner>
            <NoticeBanner tone="amber">
              <span className="text-xs">Autoscaling: {data.autoscaling.reason}</span>
            </NoticeBanner>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
              Prometheus scrape endpoint: <span className="font-mono text-slate-300">GET /metrics</span>
              <br />
              Liveness: <span className="font-mono text-slate-300">GET /health/live</span> · Readiness:{" "}
              <span className="font-mono text-slate-300">GET /health/ready</span>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Model capacity"
            description="Concurrency and expected latency priors used by the router"
            action={
              <Badge tone={selfHosted.length > 0 ? "blue" : "slate"}>
                {selfHosted.length} self-hosted
              </Badge>
            }
          />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Model</th>
                  <th className={tableClasses.th}>Provider</th>
                  <th className={tableClasses.th}>Deployment</th>
                  <th className={tableClasses.th}>Concurrency</th>
                  <th className={tableClasses.th}>Expected latency</th>
                  <th className={tableClasses.th}>Context</th>
                  <th className={tableClasses.th}>GPU cost</th>
                  <th className={tableClasses.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr key={model.id} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="text-slate-200">{model.displayName}</span>
                      <p className="font-mono text-[11px] text-slate-500">{model.slug}</p>
                    </td>
                    <td className={tableClasses.td}>{model.provider.name}</td>
                    <td className={tableClasses.td}>
                      <Badge tone={model.deploymentKind === "SELF_HOSTED" ? "amber" : "blue"}>
                        {model.deploymentKind.toLowerCase().replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className={tableClasses.td}>{model.maxConcurrency}</td>
                    <td className={tableClasses.td}>{formatMs(model.expectedLatencyMs)}</td>
                    <td className={tableClasses.td}>{compactNumber(model.contextWindow)}</td>
                    <td className={tableClasses.td}>
                      {model.gpuHourlyCostUsd !== null
                        ? `${formatUsd(model.gpuHourlyCostUsd, 2)}/hr`
                        : "—"}
                    </td>
                    <td className={tableClasses.td}>
                      <StatusBadge value={model.status} />
                    </td>
                  </tr>
                ))}
                {data.models.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={tableClasses.td}>
                      No models registered.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
