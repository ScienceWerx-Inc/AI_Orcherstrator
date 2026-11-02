import { api } from "@/lib/api";
import { Collapsible } from "@/components/forms/form-kit";
import { CreateProviderForm, ProviderActions } from "@/components/forms/provider-forms";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  StatusBadge,
  tableClasses,
} from "@/components/ui";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  let providers;
  try {
    providers = await api.providers({ page, limit: 20 });
  } catch (error) {
    return (
      <>
        <PageHeader title="Providers" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Providers"
        description="Upstream model hosts. Credentials are encrypted with AES-256-GCM and never returned by the API."
      />

      <div className="mb-4">
        <Collapsible summary="Connect a provider">
          <CreateProviderForm />
        </Collapsible>
      </div>

      <Card>
        <CardHeader title="Configured providers" description="Circuit state is updated by live request outcomes" />
        {providers.data.length === 0 ? (
          <EmptyState
            title="No providers configured"
            description="Connect OpenAI, Anthropic, Gemini, Ollama or any OpenAI-compatible endpoint."
          />
        ) : (
          <>
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th className={tableClasses.th}>Provider</th>
                    <th className={tableClasses.th}>Type</th>
                    <th className={tableClasses.th}>Endpoint</th>
                    <th className={tableClasses.th}>Status</th>
                    <th className={tableClasses.th}>Circuit</th>
                    <th className={tableClasses.th}>Models</th>
                    <th className={tableClasses.th}>Priority</th>
                    <th className={tableClasses.th}>Credentials</th>
                    <th className={tableClasses.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.data.map((provider) => (
                    <tr key={provider.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <span className="font-medium text-slate-200">{provider.name}</span>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">{provider.slug}</p>
                      </td>
                      <td className={tableClasses.td}>
                        <Badge tone="slate">{provider.type.toLowerCase().replaceAll("_", " ")}</Badge>
                      </td>
                      <td className={`${tableClasses.td} max-w-[220px] truncate font-mono text-xs`}>
                        {provider.baseUrl ?? (
                          <span className="text-slate-500">provider default</span>
                        )}
                      </td>
                      <td className={tableClasses.td}>
                        <StatusBadge value={provider.status} />
                      </td>
                      <td className={tableClasses.td}>
                        <Badge tone={provider.circuit.state === "CLOSED" ? "emerald" : "amber"}>
                          {provider.circuit.state.toLowerCase().replaceAll("_", " ")}
                        </Badge>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {provider.circuit.failures} failures
                        </p>
                      </td>
                      <td className={tableClasses.td}>{provider.modelCount}</td>
                      <td className={tableClasses.td}>{provider.priority}</td>
                      <td className={tableClasses.td}>
                        {provider.hasCredentials ? (
                          <Badge tone="emerald">set</Badge>
                        ) : (
                          <span className="text-[11px] text-slate-500">none</span>
                        )}
                      </td>
                      <td className={tableClasses.td}>
                        <ProviderActions provider={provider} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <p className="px-5 py-3 text-[11px] text-slate-500">
                Last updated {formatDate(providers.data[0]?.updatedAt)}
              </p>
              <Pagination
                page={providers.meta.page}
                totalPages={providers.meta.totalPages}
                total={providers.meta.total}
                basePath="/providers"
              />
            </div>
          </>
        )}
      </Card>
    </>
  );
}
