import Link from "next/link";
import { api } from "@/lib/api";
import { Collapsible } from "@/components/forms/form-kit";
import { CreateProjectForm } from "@/components/forms/project-forms";
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
import { compactNumber, formatDate, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; status?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const q = searchParams.q?.trim() || undefined;
  const status = searchParams.status || undefined;

  let projects;
  let policies;
  let models;
  try {
    [projects, policies, models] = await Promise.all([
      api.projects({ page, limit: 20, q, status }),
      api.policies({ limit: 100 }),
      api.models({ limit: 100 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Projects & keys" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Projects & keys"
        description="Tenant-scoped workloads, their model allowlists, rate limits and API credentials."
      />

      <div className="mb-4">
        <Collapsible summary="Create a project">
          <CreateProjectForm
            policies={policies.data.map((policy) => ({
              id: policy.id,
              label: `${policy.name} (${policy.kind.toLowerCase()})`,
            }))}
            models={models.data.map((model) => ({
              id: model.id,
              label: `${model.displayName} · ${model.provider.name}`,
            }))}
          />
        </Collapsible>
      </div>

      <Card>
        <CardHeader
          title="Projects"
          description="Every request is authenticated by a project API key and metered against a project."
          action={
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search name or slug"
                className={`${fieldClasses} h-9 w-48`}
              />
              <select name="status" defaultValue={status ?? ""} className={`${fieldClasses} h-9 w-36`}>
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <button type="submit" className={buttonClasses.secondary}>
                Filter
              </button>
            </form>
          }
        />
        {projects.data.length === 0 ? (
          <EmptyState
            title="No projects found"
            description="Create a project to issue API keys and start routing traffic."
          />
        ) : (
          <>
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th className={tableClasses.th}>Project</th>
                    <th className={tableClasses.th}>Status</th>
                    <th className={tableClasses.th}>Models</th>
                    <th className={tableClasses.th}>Keys</th>
                    <th className={tableClasses.th}>Requests</th>
                    <th className={tableClasses.th}>Month spend</th>
                    <th className={tableClasses.th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.data.map((project) => (
                    <tr key={project.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <Link
                          href={`/projects/${project.id}`}
                          className="font-medium text-slate-200 hover:text-sky-300"
                        >
                          {project.name}
                        </Link>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">{project.slug}</p>
                      </td>
                      <td className={tableClasses.td}>
                        <StatusBadge value={project.status} />
                      </td>
                      <td className={tableClasses.td}>
                        <Badge tone="slate">{project.allowedModels.length}</Badge>
                      </td>
                      <td className={tableClasses.td}>{project.apiKeyCount}</td>
                      <td className={tableClasses.td}>{compactNumber(project.requestCount)}</td>
                      <td className={tableClasses.td}>{formatUsd(project.monthSpendUsd ?? 0)}</td>
                      <td className={tableClasses.td}>{formatDate(project.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={projects.meta.page}
              totalPages={projects.meta.totalPages}
              total={projects.meta.total}
              basePath="/projects"
              searchParams={{ q, status }}
            />
          </>
        )}
      </Card>
    </>
  );
}
