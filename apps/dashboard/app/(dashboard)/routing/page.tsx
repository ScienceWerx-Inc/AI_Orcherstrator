import { api } from "@/lib/api";
import { Collapsible } from "@/components/forms/form-kit";
import { CreatePolicyForm } from "@/components/forms/settings-forms";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageHeader,
  tableClasses,
} from "@/components/ui";

export const dynamic = "force-dynamic";

function describeConfig(config: Record<string, unknown>, modelNames: Map<string, string>): string[] {
  const parts: string[] = [];
  const preferred = (config.preferredModelIds as string[] | undefined) ?? [];
  if (config.preferredModelId) preferred.unshift(String(config.preferredModelId));
  if (preferred.length > 0) {
    parts.push(
      `preferred: ${preferred
        .map((id) => modelNames.get(id) ?? `${id.slice(0, 8)}…`)
        .join(" → ")}`,
    );
  }
  if (config.maxCostUsd !== undefined) parts.push(`max cost $${String(config.maxCostUsd)}/request`);
  if (config.weights) parts.push(`weights ${JSON.stringify(config.weights)}`);
  if (config.taskModelMap) parts.push(`task map (${Object.keys(config.taskModelMap as object).length} tasks)`);
  if (parts.length === 0) parts.push("no config overrides");
  return parts;
}

export default async function RoutingPage() {
  let policies;
  let models;
  try {
    [policies, models] = await Promise.all([
      api.policies({ limit: 100 }),
      api.models({ limit: 100 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Routing policies" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  const modelNames = new Map(models.data.map((model) => [model.id, model.displayName]));

  return (
    <>
      <PageHeader
        title="Routing policies"
        description="Explainable, deterministic routing: hard filters first, then ranked scoring per policy."
      />

      <div className="mb-4">
        <Collapsible summary="Create a routing policy">
          <CreatePolicyForm />
        </Collapsible>
      </div>

      <Card>
        <CardHeader
          title="Policies"
          description="Requested model IDs become a preference; the policy still governs fallback order."
        />
        {policies.data.length === 0 ? (
          <EmptyState title="No routing policies" description="Create one above to control model selection." />
        ) : (
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Policy</th>
                  <th className={tableClasses.th}>Strategy</th>
                  <th className={tableClasses.th}>Config</th>
                  <th className={tableClasses.th}>Projects</th>
                  <th className={tableClasses.th}>Default</th>
                </tr>
              </thead>
              <tbody>
                {policies.data.map((policy) => (
                  <tr key={policy.id} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="font-medium text-slate-200">{policy.name}</span>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">{policy.slug}</p>
                      {policy.description ? (
                        <p className="mt-1 max-w-md text-[11px] text-slate-500">{policy.description}</p>
                      ) : null}
                    </td>
                    <td className={tableClasses.td}>
                      <Badge tone="blue">{policy.kind.toLowerCase().replaceAll("_", " ")}</Badge>
                    </td>
                    <td className={tableClasses.td}>
                      <ul className="space-y-0.5 text-[11px] text-slate-400">
                        {describeConfig(policy.config as Record<string, unknown>, modelNames).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </td>
                    <td className={tableClasses.td}>{policy._count?.projects ?? 0}</td>
                    <td className={tableClasses.td}>
                      {policy.isDefault ? (
                        <Badge tone="emerald">default</Badge>
                      ) : (
                        <span className="text-[11px] text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader title="1 · Hard filters" />
          <CardBody className="space-y-1 text-xs text-slate-400">
            <p>Tenant + project allowlist</p>
            <p>Modality and model type</p>
            <p>Context window and streaming capability</p>
            <p>Pricing present, cost ceiling, circuit state</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="2 · Rank" />
          <CardBody className="space-y-1 text-xs text-slate-400">
            <p>Cheapest estimated cost</p>
            <p>Lowest expected latency</p>
            <p>Highest quality score</p>
            <p>Preferred order, task map, custom weights</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="3 · Invoke" />
          <CardBody className="space-y-1 text-xs text-slate-400">
            <p>Retry with jittered backoff</p>
            <p>Fallback across ranked candidates</p>
            <p>Strip request overrides between attempts</p>
            <p>Bill only successful usage</p>
          </CardBody>
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-slate-500">
        Need the full scoring rules? See{" "}
        <span className="font-mono text-slate-400">docs/routing.md</span> in the repository.
      </p>
    </>
  );
}
