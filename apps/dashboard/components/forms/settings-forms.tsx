"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/client";
import type { Alert, Budget } from "@/lib/types";
import { buttonClasses, fieldClasses } from "../ui";
import { Feedback, Field, SubmitButton, Toggle, useAction } from "./form-kit";

export function CreatePolicyForm() {
  const { pending, error, notice, run, setError } = useAction();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("PREFERRED_FALLBACK");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [config, setConfig] = useState("{}");

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        let parsed: unknown;
        try {
          parsed = JSON.parse(config || "{}");
        } catch {
          setError("Config must be valid JSON");
          return;
        }
        run(async () => {
          await adminFetch("routing-policies", {
            method: "POST",
            body: JSON.stringify({
              name,
              kind,
              description: description || undefined,
              isDefault,
              config: parsed,
            }),
          });
          setName("");
          setDescription("");
          setConfig("{}");
          setIsDefault(false);
          return "Routing policy created.";
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClasses}
            placeholder="Cost-first with quality floor"
          />
        </Field>
        <Field label="Strategy">
          <select value={kind} onChange={(event) => setKind(event.target.value)} className={fieldClasses}>
            {[
              ["CHEAPEST", "Cheapest viable"],
              ["LOWEST_LATENCY", "Lowest latency"],
              ["HIGHEST_QUALITY", "Highest quality"],
              ["PREFERRED_FALLBACK", "Preferred with fallback"],
              ["TASK_BASED", "Task based"],
              ["CUSTOM_WEIGHTED", "Custom weighted"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={fieldClasses}
          placeholder="Cheapest model that still clears the support quality bar"
        />
      </Field>
      <Field
        label="Config (JSON)"
        hint='Examples: {"preferredModelIds":["<uuid>"]}, {"weights":{"cost":0.5,"latency":0.2,"quality":0.3}}, {"maxCostUsd":0.02}'
      >
        <textarea
          rows={4}
          value={config}
          onChange={(event) => setConfig(event.target.value)}
          className={`${fieldClasses} font-mono text-xs`}
          spellCheck={false}
        />
      </Field>
      <Toggle checked={isDefault} onChange={setIsDefault} label="Set as organisation default" />
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending}>Create policy</SubmitButton>
    </form>
  );
}

export function CreateBudgetForm({
  projects,
}: {
  projects: Array<{ id: string; label: string }>;
}) {
  const { pending, error, notice, run, setError } = useAction();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [period, setPeriod] = useState("MONTHLY");
  const [limitUsd, setLimitUsd] = useState("100");
  const [softLimitPct, setSoftLimitPct] = useState("80");
  const [hardLimit, setHardLimit] = useState(true);

  if (projects.length === 0) {
    return <p className="text-xs text-slate-500">Create a project before attaching a budget.</p>;
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!projectId) {
          setError("Select a project");
          return;
        }
        run(async () => {
          await adminFetch("budgets", {
            method: "POST",
            body: JSON.stringify({
              projectId,
              period,
              limitUsd: Number(limitUsd),
              softLimitPct: Number(softLimitPct),
              hardLimit,
            }),
          });
          return `Budget saved for the ${period.toLowerCase()} window.`;
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project">
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className={fieldClasses}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period">
          <select value={period} onChange={(event) => setPeriod(event.target.value)} className={fieldClasses}>
            <option value="DAILY">Daily</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </Field>
        <Field label="Limit (USD)">
          <input
            required
            type="number"
            min={0.01}
            step="0.01"
            value={limitUsd}
            onChange={(event) => setLimitUsd(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Soft limit (% of budget)">
          <input
            type="number"
            min={1}
            max={100}
            value={softLimitPct}
            onChange={(event) => setSoftLimitPct(event.target.value)}
            className={fieldClasses}
          />
        </Field>
      </div>
      <Toggle
        checked={hardLimit}
        onChange={setHardLimit}
        label="Hard limit — reject requests with HTTP 402 once exceeded"
      />
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending}>Save budget</SubmitButton>
    </form>
  );
}

export function BudgetActions({ budget }: { budget: Budget }) {
  const { pending, error, notice, run } = useAction();
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        className={buttonClasses.danger}
        onClick={() => {
          if (!window.confirm(`Delete ${budget.period.toLowerCase()} budget for ${budget.project.name}?`))
            return;
          run(async () => {
            await adminFetch(`budgets/${budget.id}`, { method: "DELETE" });
            return "Budget deleted.";
          });
        }}
      >
        Delete
      </button>
      <Feedback error={error} notice={notice} />
    </div>
  );
}

export function AlertActions({ alert }: { alert: Alert }) {
  const { pending, error, notice, run } = useAction();
  const done = ["RESOLVED"].includes(alert.status);
  if (done) return <span className="text-[11px] text-slate-500">closed</span>;

  return (
    <div className="flex flex-wrap gap-2">
      {alert.status === "OPEN" ? (
        <button
          type="button"
          disabled={pending}
          className={buttonClasses.secondary}
          onClick={() =>
            run(async () => {
              await adminFetch(`alerts/${alert.id}/acknowledge`, { method: "POST" });
              return "Alert acknowledged.";
            })
          }
        >
          Acknowledge
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        className={buttonClasses.secondary}
        onClick={() =>
          run(async () => {
            await adminFetch(`alerts/${alert.id}/resolve`, { method: "POST" });
            return "Alert resolved.";
          })
        }
      >
        Resolve
      </button>
      <Feedback error={error} notice={notice} />
    </div>
  );
}

export function AddPricingForm({ modelId }: { modelId: string }) {  const { pending, error, notice, run } = useAction();
  const [inputPer1m, setInputPer1m] = useState("0");
  const [outputPer1m, setOutputPer1m] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          await adminFetch(`models/${modelId}/pricing`, {
            method: "POST",
            body: JSON.stringify({
              currency: "USD",
              inputPer1m: Number(inputPer1m),
              outputPer1m: Number(outputPer1m),
              effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
            }),
          });
          return "New price version appended. Historical usage keeps its original price.";
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Input USD / 1M">
          <input
            type="number"
            step="0.000001"
            min={0}
            value={inputPer1m}
            onChange={(event) => setInputPer1m(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Output USD / 1M">
          <input
            type="number"
            step="0.000001"
            min={0}
            value={outputPer1m}
            onChange={(event) => setOutputPer1m(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Effective from" hint="Leave empty for now">
          <input
            type="datetime-local"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className={fieldClasses}
          />
        </Field>
      </div>
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending} className={buttonClasses.secondary}>
        Append price version
      </SubmitButton>
    </form>
  );
}

export function PricingPanel({
  models,
}: {
  models: Array<{ id: string; label: string }>;
}) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  if (models.length === 0) {
    return <p className="text-xs text-slate-500">Register a model before adding prices.</p>;
  }
  return (
    <div className="space-y-4">
      <Field label="Model">
        <select
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          className={fieldClasses}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </Field>
      <AddPricingForm modelId={modelId} />
    </div>
  );
}
