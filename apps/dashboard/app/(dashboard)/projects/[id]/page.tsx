import Link from "next/link";
import { notFound } from "next/navigation";
import { GatewayError, api } from "@/lib/api";
import { Collapsible } from "@/components/forms/form-kit";
import { CreateKeyForm, KeyActions, ProjectStatusToggle } from "@/components/forms/project-forms";
import { BudgetActions } from "@/components/forms/settings-forms";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Progress,
  StatusBadge,
  buttonClasses,
  tableClasses,
} from "@/components/ui";
import { compactNumber, formatDate, formatMs, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const result = await (async () => {
    try {
      return await Promise.all([
        api.project(params.id),
        api.projectKeys(params.id, { limit: 100 }),
        api.usage({ projectId: params.id, limit: 25 }),
        api.budgets({ limit: 100 }),
      ]);
    } catch (error) {
      if (error instanceof GatewayError && error.status === 404) notFound();
      return null;
    }
  })();

  if (!result) {
    return (
      <>
        <PageHeader title="Project" />
        <ErrorBanner message="Unable to load this project. Check that the gateway is running." />
      </>
    );
  }

  const [projectResponse, keys, usage, budgetsResponse] = result;
  const project = projectResponse.data;
  const budgets = budgetsResponse.data.filter((budget) => budget.projectId === project.id);

  return (
    <>
      <PageHeader title={project.name} description={project.description ?? project.slug}>
        <Link href="/projects" className={buttonClasses.ghost}>
          ← All projects
        </Link>
        <ProjectStatusToggle projectId={project.id} status={project.status} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge value={project.status} />
        <Badge tone="blue">{project.slug}</Badge>
        {project.allowedModalities.map((modality) => (
          <Badge key={modality} tone="violet">
            {modality.toLowerCase()}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Month spend", formatUsd(project.monthSpendUsd ?? 0)],
          ["Month requests", compactNumber(project.monthRequests ?? 0)],
          ["Month tokens", compactNumber(project.monthTokens ?? 0)],
          ["Active keys", String(project.apiKeyCount)],
        ].map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Configuration" description="Limits enforced by the gateway" />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            {[
              ["Requests / minute", compactNumber(project.rateLimitRpm)],
              ["Tokens / minute", compactNumber(project.rateLimitTpm)],
              ["Max concurrency", String(project.maxConcurrentRequests)],
              ["Max request tokens", compactNumber(project.maxRequestTokens)],
              ["Retention", `${project.retentionDays} days`],
              [
                "Default policy",
                project.defaultPolicy
                  ? `${project.defaultPolicy.name} (${project.defaultPolicy.kind.toLowerCase()})`
                  : "Organisation default",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="mt-1 text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Budgets"
            description="Hard limits reject with 402; soft limits raise alerts"
            action={
              <Link href="/settings" className={buttonClasses.ghost}>
                Manage
              </Link>
            }
          />
          <div className="space-y-4 p-5">
            {budgets.length === 0 ? (
              <p className="text-xs text-slate-500">No budget attached to this project.</p>
            ) : (
              budgets.map((budget) => (
                <div key={budget.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {budget.period.toLowerCase()} · {formatUsd(budget.limitUsd, 2)}
                      {budget.hardLimit ? " hard" : " soft"}
                    </span>
                    <span className="text-slate-500">
                      {formatUsd(budget.spentUsd)} spent · {budget.usedPct.toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={budget.usedPct}
                    tone={
                      budget.usedPct >= 100
                        ? "rose"
                        : budget.usedPct >= budget.softLimitPct
                          ? "amber"
                          : "emerald"
                    }
                  />
                  <BudgetActions budget={budget} />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="API keys"
            description="Secrets are hashed with SHA-256; the plaintext is shown once at creation."
          />
          <div className="border-b border-white/10 p-5">
            <Collapsible summary="Issue a new API key">
              <CreateKeyForm projectId={project.id} />
            </Collapsible>
          </div>
          {keys.data.length === 0 ? (
            <EmptyState title="No API keys yet" description="Issue a key to let a workload call /v1." />
          ) : (
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th className={tableClasses.th}>Name</th>
                    <th className={tableClasses.th}>Prefix</th>
                    <th className={tableClasses.th}>Access</th>
                    <th className={tableClasses.th}>Last used</th>
                    <th className={tableClasses.th}>Expires</th>
                    <th className={tableClasses.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.data.map((key) => (
                    <tr key={key.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <span className="font-medium text-slate-200">{key.name}</span>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          created {formatDate(key.createdAt)}
                        </p>
                      </td>
                      <td className={`${tableClasses.td} font-mono text-xs`}>{key.prefix}…</td>
                      <td className={tableClasses.td}>
                        <KeyActions projectId={project.id} apiKey={key} />
                      </td>
                      <td className={tableClasses.td}>{formatDate(key.lastUsedAt)}</td>
                      <td className={tableClasses.td}>{formatDate(key.expiresAt)}</td>
                      <td className={tableClasses.td}>
                        {key.revokedAt ? (
                          <span className="text-[11px] text-slate-500">revoked</span>
                        ) : (
                          <Badge tone="emerald">usable</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Allowed models" description="The routing allowlist for this project" />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Model</th>
                  <th className={tableClasses.th}>Provider</th>
                  <th className={tableClasses.th}>Type</th>
                  <th className={tableClasses.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {project.allowedModels.map((model) => (
                  <tr key={model.id} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="text-slate-200">{model.displayName}</span>
                      <p className="font-mono text-[11px] text-slate-500">{model.slug}</p>
                    </td>
                    <td className={tableClasses.td}>{model.provider.name}</td>
                    <td className={tableClasses.td}>
                      <Badge tone="slate">{model.modelType.toLowerCase()}</Badge>
                    </td>
                    <td className={tableClasses.td}>
                      <StatusBadge value={model.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent requests"
            description="Latest calls for this project"
            action={
              <Link href={`/usage?projectId=${project.id}`} className={buttonClasses.ghost}>
                Full log
              </Link>
            }
          />
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>When</th>
                  <th className={tableClasses.th}>Model</th>
                  <th className={tableClasses.th}>Status</th>
                  <th className={tableClasses.th}>Tokens</th>
                  <th className={tableClasses.th}>Cost</th>
                  <th className={tableClasses.th}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={tableClasses.td}>
                      No requests recorded yet.
                    </td>
                  </tr>
                ) : (
                  usage.data.map((request) => (
                    <tr key={request.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>{formatDate(request.createdAt)}</td>
                      <td className={tableClasses.td}>
                        {request.model?.displayName ?? "—"}
                        {request.fallbackUsed ? (
                          <Badge tone="amber" className="ml-1.5">
                            fallback
                          </Badge>
                        ) : null}
                      </td>
                      <td className={tableClasses.td}>
                        <StatusBadge value={request.status} />
                      </td>
                      <td className={tableClasses.td}>
                        {compactNumber(request.inputTokens + request.outputTokens)}
                      </td>
                      <td className={tableClasses.td}>{formatUsd(Number(request.costUsd))}</td>
                      <td className={tableClasses.td}>{formatMs(request.latencyMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
