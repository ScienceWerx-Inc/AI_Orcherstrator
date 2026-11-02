import { api, getSession } from "@/lib/api";
import { Collapsible } from "@/components/forms/form-kit";
import {
  AlertActions,
  BudgetActions,
  CreateBudgetForm,
} from "@/components/forms/settings-forms";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Progress,
  StatusBadge,
  buttonClasses,
  fieldClasses,
  tableClasses,
} from "@/components/ui";
import { formatDate, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status = searchParams.status || undefined;

  let budgets;
  let alerts;
  let projects;
  try {
    [budgets, alerts, projects] = await Promise.all([
      api.budgets({ limit: 100 }),
      api.alerts({ limit: 50, status }),
      api.projects({ limit: 100 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Budgets & alerts" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  const session = await getSession();

  return (
    <>
      <PageHeader
        title="Budgets & alerts"
        description="Spend guardrails per project and the operational alerts they raise."
      />

      <div className="mb-4">
        <Collapsible summary="Create or update a budget">
          <CreateBudgetForm
            projects={projects.data.map((project) => ({
              id: project.id,
              label: `${project.name} (${project.slug})`,
            }))}
          />
        </Collapsible>
      </div>

      <Card>
        <CardHeader
          title="Budgets"
          description="A hard limit rejects inference with HTTP 402 when the next request would exceed it."
        />
        {budgets.data.length === 0 ? (
          <EmptyState
            title="No budgets configured"
            description="Attach a daily or monthly budget to keep spend bounded."
          />
        ) : (
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th className={tableClasses.th}>Project</th>
                  <th className={tableClasses.th}>Period</th>
                  <th className={tableClasses.th}>Limit</th>
                  <th className={tableClasses.th}>Spent</th>
                  <th className={tableClasses.th}>Usage</th>
                  <th className={tableClasses.th}>Mode</th>
                  <th className={tableClasses.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {budgets.data.map((budget) => (
                  <tr key={budget.id} className={tableClasses.row}>
                    <td className={tableClasses.td}>
                      <span className="text-slate-200">{budget.project.name}</span>
                      <p className="font-mono text-[11px] text-slate-500">{budget.project.slug}</p>
                    </td>
                    <td className={tableClasses.td}>{budget.period.toLowerCase()}</td>
                    <td className={tableClasses.td}>{formatUsd(budget.limitUsd, 2)}</td>
                    <td className={tableClasses.td}>{formatUsd(budget.spentUsd)}</td>
                    <td className={tableClasses.td}>
                      <div className="flex w-40 items-center gap-2">
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
                        <span className="w-12 text-right text-[11px] tabular-nums text-slate-400">
                          {budget.usedPct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className={tableClasses.td}>
                      {budget.hardLimit ? (
                        <Badge tone="rose">hard</Badge>
                      ) : (
                        <Badge tone="amber">soft</Badge>
                      )}
                      <p className="mt-1 text-[11px] text-slate-500">
                        alert at {budget.softLimitPct}%
                      </p>
                    </td>
                    <td className={tableClasses.td}>
                      <BudgetActions budget={budget} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Alerts"
            description="Budget and reliability signals"
            action={
              <form method="get" className="flex items-center gap-2">
                <select name="status" defaultValue={status ?? ""} className={`${fieldClasses} h-9 w-40`}>
                  <option value="">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="ACKNOWLEDGED">Acknowledged</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
                <button type="submit" className={buttonClasses.secondary}>
                  Filter
                </button>
              </form>
            }
          />
          {alerts.data.length === 0 ? (
            <EmptyState title="No alerts" description="Nothing needs attention right now." />
          ) : (
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th className={tableClasses.th}>Severity</th>
                    <th className={tableClasses.th}>Alert</th>
                    <th className={tableClasses.th}>Project</th>
                    <th className={tableClasses.th}>Status</th>
                    <th className={tableClasses.th}>Raised</th>
                    <th className={tableClasses.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.data.map((alert) => (
                    <tr key={alert.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <StatusBadge value={alert.severity} />
                      </td>
                      <td className={tableClasses.td}>
                        <span className="text-slate-200">{alert.title}</span>
                        <p className="mt-0.5 text-[11px] text-slate-500">{alert.message}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-600">{alert.type}</p>
                      </td>
                      <td className={tableClasses.td}>{alert.project?.name ?? "organisation"}</td>
                      <td className={tableClasses.td}>
                        <StatusBadge value={alert.status} />
                      </td>
                      <td className={tableClasses.td}>{formatDate(alert.createdAt)}</td>
                      <td className={tableClasses.td}>
                        <AlertActions alert={alert} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Session" description="Signed-in operator and organisation scope" />
          <CardBody>
            {session ? (
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-4">
                {[
                  ["Name", session.name],
                  ["Email", session.email],
                  ["Role", session.role.toLowerCase()],
                  ["Organisation", session.orgName],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
                    <dd className="mt-1 text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-slate-500">Session details unavailable.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
