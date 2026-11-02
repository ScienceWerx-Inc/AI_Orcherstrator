import Link from "next/link";
import { api } from "@/lib/api";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  StatusBadge,
  buttonClasses,
  fieldClasses,
  tableClasses,
} from "@/components/ui";
import { compactNumber, formatDate, formatMs, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED", "RATE_LIMITED", "BUDGET_EXCEEDED"];

export default async function UsagePage({
  searchParams,
}: {
  searchParams: { page?: string; projectId?: string; status?: string; modelId?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const projectId = searchParams.projectId || undefined;
  const status = searchParams.status || undefined;
  const modelId = searchParams.modelId || undefined;

  let usage;
  let projects;
  try {
    [usage, projects] = await Promise.all([
      api.usage({ page, limit: 25, projectId, status, modelId }),
      api.projects({ limit: 100 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Request log" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Request log"
        description="Every inference request is persisted with routing decision, token usage and billed cost."
      />

      <Card>
        <CardHeader
          title="Requests"
          description={`${usage.meta.total.toLocaleString()} requests match the current filters`}
          action={
            <form method="get" className="flex flex-wrap items-center gap-2">
              <select
                name="projectId"
                defaultValue={projectId ?? ""}
                className={`${fieldClasses} h-9 w-44`}
              >
                <option value="">All projects</option>
                {projects.data.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select name="status" defaultValue={status ?? ""} className={`${fieldClasses} h-9 w-40`}>
                <option value="">All statuses</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.toLowerCase().replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonClasses.secondary}>
                Filter
              </button>
            </form>
          }
        />

        {usage.data.length === 0 ? (
          <EmptyState
            title="No requests match"
            description="Send a request to /v1/chat/completions with a project API key, or relax the filters."
          />
        ) : (
          <>
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th className={tableClasses.th}>When</th>
                    <th className={tableClasses.th}>Project</th>
                    <th className={tableClasses.th}>Model / provider</th>
                    <th className={tableClasses.th}>Status</th>
                    <th className={tableClasses.th}>Tokens</th>
                    <th className={tableClasses.th}>Cost</th>
                    <th className={tableClasses.th}>Latency</th>
                    <th className={tableClasses.th}>Retries</th>
                    <th className={tableClasses.th}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.map((request) => (
                    <tr key={request.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <span className="text-slate-300">{formatDate(request.createdAt)}</span>
                        <p className="font-mono text-[10px] text-slate-600">
                          {request.traceId.slice(0, 16)}…
                        </p>
                      </td>
                      <td className={tableClasses.td}>
                        <Link
                          href={`/projects/${request.project.id}`}
                          className="text-slate-300 hover:text-sky-300"
                        >
                          {request.project.name}
                        </Link>
                        <p className="text-[11px] text-slate-500">{request.endpoint}</p>
                      </td>
                      <td className={tableClasses.td}>
                        {request.model?.displayName ?? (
                          <span className="text-slate-500">none</span>
                        )}
                        <p className="font-mono text-[11px] text-slate-500">
                          {request.model?.slug ?? request.errorCode ?? "—"}
                        </p>
                      </td>
                      <td className={tableClasses.td}>
                        <StatusBadge value={request.status} />
                        {request.httpStatus ? (
                          <p className="mt-1 text-[10px] text-slate-500">HTTP {request.httpStatus}</p>
                        ) : null}
                      </td>
                      <td className={tableClasses.td}>
                        {compactNumber(request.inputTokens + request.outputTokens)}
                        <p className="text-[11px] text-slate-500">
                          {compactNumber(request.inputTokens)} / {compactNumber(request.outputTokens)}
                        </p>
                      </td>
                      <td className={tableClasses.td}>{formatUsd(Number(request.costUsd))}</td>
                      <td className={tableClasses.td}>
                        {formatMs(request.latencyMs)}
                        {request.ttftMs ? (
                          <p className="text-[11px] text-slate-500">TTFT {formatMs(request.ttftMs)}</p>
                        ) : null}
                      </td>
                      <td className={tableClasses.td}>
                        {request.retryCount > 0 ? (
                          <Badge tone="amber">{request.retryCount}</Badge>
                        ) : (
                          <span className="text-[11px] text-slate-500">0</span>
                        )}
                        {request.fallbackUsed ? (
                          <p className="mt-1">
                            <Badge tone="violet">fallback</Badge>
                          </p>
                        ) : null}
                      </td>
                      <td className={tableClasses.td}>
                        {request.routingDecision ? (
                          <details>
                            <summary className="cursor-pointer text-[11px] text-sky-300">
                              inspect
                            </summary>
                            <pre className="scrollbar-thin mt-2 max-h-64 max-w-md overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-400">
                              {JSON.stringify(request.routingDecision, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-[11px] text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={usage.meta.page}
              totalPages={usage.meta.totalPages}
              total={usage.meta.total}
              basePath="/usage"
              searchParams={{ projectId, status, modelId }}
            />
          </>
        )}
      </Card>
    </>
  );
}
