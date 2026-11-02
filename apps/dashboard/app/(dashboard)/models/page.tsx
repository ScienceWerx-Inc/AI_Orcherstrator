import { api } from "@/lib/api";
import { Collapsible } from "@/components/forms/form-kit";
import { CreateModelForm } from "@/components/forms/provider-forms";
import { PricingPanel } from "@/components/forms/settings-forms";
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
import { compactNumber, formatMs, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MODEL_TYPES = ["CHAT", "EMBEDDING", "IMAGE", "AUDIO_TRANSCRIPTION", "AUDIO_SPEECH", "VIDEO"];

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: {
    page?: string;
    q?: string;
    modelType?: string;
    providerId?: string;
    status?: string;
  };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const q = searchParams.q?.trim() || undefined;
  const modelType = searchParams.modelType || undefined;
  const providerId = searchParams.providerId || undefined;
  const status = searchParams.status || undefined;

  let models;
  let providers;
  try {
    [models, providers] = await Promise.all([
      api.models({ page, limit: 20, q, modelType, providerId, status }),
      api.providers({ limit: 100 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Model registry" />
        <ErrorBanner message={(error as Error).message} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Model registry"
        description="Provider-hosted models with capabilities, quality/latency priors and append-only pricing."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Collapsible summary="Register a model">
          <CreateModelForm
            providers={providers.data.map((provider) => ({
              id: provider.id,
              label: `${provider.name} (${provider.type})`,
            }))}
          />
        </Collapsible>
        <Collapsible summary="Append a price version">
          <PricingPanel
            models={models.data.map((model) => ({
              id: model.id,
              label: `${model.displayName} · current ${
                model.pricing ? `${model.pricing.inputPer1m}/${model.pricing.outputPer1m}` : "unpriced"
              }`,
            }))}
          />
        </Collapsible>
      </div>

      <Card>
        <CardHeader
          title="Models"
          description={`${models.meta.total} registered models`}
          action={
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search"
                className={`${fieldClasses} h-9 w-36`}
              />
              <select name="modelType" defaultValue={modelType ?? ""} className={`${fieldClasses} h-9 w-40`}>
                <option value="">All types</option>
                {MODEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.toLowerCase().replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <select
                name="providerId"
                defaultValue={providerId ?? ""}
                className={`${fieldClasses} h-9 w-40`}
              >
                <option value="">All providers</option>
                {providers.data.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonClasses.secondary}>
                Filter
              </button>
            </form>
          }
        />

        {models.data.length === 0 ? (
          <EmptyState
            title="No models match these filters"
            description="Register a model, or relax the filters above."
          />
        ) : (
          <>
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th className={tableClasses.th}>Model</th>
                    <th className={tableClasses.th}>Provider</th>
                    <th className={tableClasses.th}>Type</th>
                    <th className={tableClasses.th}>Deployment</th>
                    <th className={tableClasses.th}>Context</th>
                    <th className={tableClasses.th}>Price / 1M</th>
                    <th className={tableClasses.th}>Quality</th>
                    <th className={tableClasses.th}>Latency</th>
                    <th className={tableClasses.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {models.data.map((model) => (
                    <tr key={model.id} className={tableClasses.row}>
                      <td className={tableClasses.td}>
                        <span className="font-medium text-slate-200">{model.displayName}</span>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {model.slug} → {model.externalModelId}
                        </p>
                      </td>
                      <td className={tableClasses.td}>
                        {model.provider.name}
                        <p className="text-[11px] text-slate-500">{model.provider.type}</p>
                      </td>
                      <td className={tableClasses.td}>
                        <Badge tone="slate">{model.modelType.toLowerCase()}</Badge>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {model.modalities.map((modality) => (
                            <Badge key={modality} tone="violet">
                              {modality.toLowerCase()}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className={tableClasses.td}>
                        {model.deploymentKind === "SELF_HOSTED" ? (
                          <Badge tone="amber">self-hosted</Badge>
                        ) : (
                          <Badge tone="blue">external</Badge>
                        )}
                        {model.quantization ? (
                          <p className="mt-1 text-[11px] text-slate-500">{model.quantization}</p>
                        ) : null}
                      </td>
                      <td className={tableClasses.td}>{compactNumber(model.contextWindow)}</td>
                      <td className={tableClasses.td}>
                        {model.pricing ? (
                          <>
                            <span className="text-slate-200">
                              {formatUsd(model.pricing.inputPer1m)}
                            </span>
                            <span className="text-slate-500"> / </span>
                            <span className="text-slate-200">
                              {formatUsd(model.pricing.outputPer1m)}
                            </span>
                            <p className="text-[11px] text-slate-500">
                              {model.pricing.currency} · v{model.version}
                            </p>
                          </>
                        ) : model.gpuHourlyCostUsd !== null ? (
                          <span className="text-amber-300">
                            {formatUsd(model.gpuHourlyCostUsd, 2)}/GPU-hr
                          </span>
                        ) : (
                          <span className="text-rose-300">unpriced</span>
                        )}
                      </td>
                      <td className={tableClasses.td}>
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums">{model.qualityScore}</span>
                          <div className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-sky-400"
                              style={{ width: `${model.qualityScore}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className={tableClasses.td}>{formatMs(model.expectedLatencyMs)}</td>
                      <td className={tableClasses.td}>
                        <StatusBadge value={model.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={models.meta.page}
              totalPages={models.meta.totalPages}
              total={models.meta.total}
              basePath="/models"
              searchParams={{ q, modelType, providerId, status }}
            />
          </>
        )}
      </Card>
    </>
  );
}
