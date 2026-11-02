"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/client";
import type { Provider } from "@/lib/types";
import { Badge, buttonClasses, fieldClasses } from "../ui";
import { Feedback, Field, SubmitButton, Toggle, useAction } from "./form-kit";

const PROVIDER_TYPES = [
  ["OPENAI", "OpenAI"],
  ["ANTHROPIC", "Anthropic"],
  ["GEMINI", "Google Gemini"],
  ["OLLAMA", "Ollama (self-hosted)"],
  ["OPENAI_COMPATIBLE", "OpenAI-compatible"],
  ["MOCK", "Mock (local testing)"],
] as const;

export function CreateProviderForm() {
  const { pending, error, notice, run } = useAction();
  const [name, setName] = useState("");
  const [type, setType] = useState("OPENAI");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState("50");

  const needsKey = ["OPENAI", "ANTHROPIC", "GEMINI"].includes(type);
  const needsUrl = ["OLLAMA", "OPENAI_COMPATIBLE"].includes(type);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          await adminFetch("providers", {
            method: "POST",
            body: JSON.stringify({
              name,
              type,
              baseUrl: baseUrl || undefined,
              credentials: apiKey ? { apiKey } : {},
              priority: Number(priority),
            }),
          });
          setName("");
          setBaseUrl("");
          setApiKey("");
          return "Provider connected. Credentials are encrypted at rest.";
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
            placeholder="OpenAI production"
          />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(event) => setType(event.target.value)} className={fieldClasses}>
            {PROVIDER_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {needsUrl ? (
        <Field label="Base URL" hint="Required for Ollama and OpenAI-compatible endpoints">
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className={fieldClasses}
            placeholder="http://localhost:11434"
          />
        </Field>
      ) : (
        <Field label="Base URL" hint="Optional override for gateways and proxies">
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className={fieldClasses}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
      )}
      {type !== "MOCK" && type !== "OLLAMA" ? (
        <Field
          label="API key"
          hint={needsKey ? "Required for hosted providers" : "Optional for self-hosted compatible servers"}
        >
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className={fieldClasses}
            placeholder="sk-…"
            autoComplete="new-password"
          />
        </Field>
      ) : null}
      <Field label="Routing priority" hint="Lower numbers are preferred when policies do not pin a provider">
        <input
          type="number"
          min={0}
          max={100}
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className={fieldClasses}
        />
      </Field>
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending}>Add provider</SubmitButton>
    </form>
  );
}

export function ProviderActions({ provider }: { provider: Provider }) {
  const { pending, error, notice, run } = useAction();
  const [testResult, setTestResult] = useState<string | null>(null);
  const disabled = provider.status === "DISABLED";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={buttonClasses.secondary}
          onClick={() =>
            run(async () => {
              const response = await adminFetch<{
                data: { ok: boolean; latencyMs: number; message?: string };
              }>(`providers/${provider.id}/test`, { method: "POST" });
              const result = response.data;
              if (!result.ok) throw new Error(result.message ?? "Provider health check failed");
              setTestResult(`Healthy · ${result.latencyMs} ms`);
            })
          }
        >
          Test connection
        </button>
        <button
          type="button"
          disabled={pending}
          className={buttonClasses.secondary}
          onClick={() =>
            run(async () => {
              await adminFetch(`providers/${provider.id}`, {
                method: "PATCH",
                body: JSON.stringify({ status: disabled ? "ACTIVE" : "DISABLED" }),
              });
              return disabled ? "Provider enabled." : "Provider disabled.";
            })
          }
        >
          {disabled ? "Enable" : "Disable"}
        </button>
        <button
          type="button"
          disabled={pending}
          className={buttonClasses.danger}
          onClick={() => {
            if (!window.confirm(`Delete provider "${provider.name}"? Models must be removed first.`))
              return;
            run(async () => {
              await adminFetch(`providers/${provider.id}`, { method: "DELETE" });
              return "Provider deleted.";
            });
          }}
        >
          Delete
        </button>
      </div>
      {testResult ? (
        <p className="text-xs text-emerald-300">
          <Badge tone="emerald">healthy</Badge> <span className="ml-1">{testResult}</span>
        </p>
      ) : null}
      <Feedback error={error} notice={notice} />
    </div>
  );
}

export function CreateModelForm({ providers }: { providers: Array<{ id: string; label: string }> }) {
  const { pending, error, notice, run } = useAction();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [externalModelId, setExternalModelId] = useState("");
  const [modelType, setModelType] = useState("CHAT");
  const [deploymentKind, setDeploymentKind] = useState("EXTERNAL");
  const [contextWindow, setContextWindow] = useState("32768");
  const [maxOutputTokens, setMaxOutputTokens] = useState("4096");
  const [qualityScore, setQualityScore] = useState("50");
  const [expectedLatencyMs, setExpectedLatencyMs] = useState("800");
  const [inputPer1m, setInputPer1m] = useState("0.15");
  const [outputPer1m, setOutputPer1m] = useState("0.60");
  const [gpuHourlyCostUsd, setGpuHourlyCostUsd] = useState("0");
  const [supportsStreaming, setSupportsStreaming] = useState(true);
  const [supportsVision, setSupportsVision] = useState(false);

  if (providers.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        Add a provider first — every model must be hosted by a provider.
      </p>
    );
  }

  const selfHosted = deploymentKind === "SELF_HOSTED";

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          await adminFetch("models", {
            method: "POST",
            body: JSON.stringify({
              providerId,
              displayName,
              slug: slug || undefined,
              externalModelId,
              modelType,
              deploymentKind,
              modalities: supportsVision ? ["TEXT", "IMAGE"] : ["TEXT"],
              contextWindow: Number(contextWindow),
              maxOutputTokens: Number(maxOutputTokens),
              qualityScore: Number(qualityScore),
              expectedLatencyMs: Number(expectedLatencyMs),
              supportsStreaming,
              gpuHourlyCostUsd: selfHosted ? Number(gpuHourlyCostUsd) : undefined,
              ...(selfHosted
                ? {}
                : {
                    pricing: {
                      currency: "USD",
                      inputPer1m: Number(inputPer1m),
                      outputPer1m: Number(outputPer1m),
                    },
                  }),
            }),
          });
          setDisplayName("");
          setSlug("");
          setExternalModelId("");
          return "Model registered with versioned pricing.";
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Provider">
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className={fieldClasses}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Display name">
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={fieldClasses}
            placeholder="GPT-4o mini"
          />
        </Field>
        <Field label="Slug" hint="Optional — derived from the display name">
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className={fieldClasses}
            placeholder="gpt-4o-mini"
          />
        </Field>
        <Field label="Provider model ID">
          <input
            required
            value={externalModelId}
            onChange={(event) => setExternalModelId(event.target.value)}
            className={fieldClasses}
            placeholder="gpt-4o-mini"
          />
        </Field>
        <Field label="Model type">
          <select
            value={modelType}
            onChange={(event) => {
              setModelType(event.target.value);
              if (event.target.value !== "CHAT") setSupportsStreaming(false);
            }}
            className={fieldClasses}
          >
            {[
              ["CHAT", "Chat"],
              ["EMBEDDING", "Embedding"],
              ["IMAGE", "Image generation"],
              ["AUDIO_TRANSCRIPTION", "Audio transcription"],
              ["AUDIO_SPEECH", "Speech synthesis"],
              ["VIDEO", "Video"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deployment">
          <select
            value={deploymentKind}
            onChange={(event) => setDeploymentKind(event.target.value)}
            className={fieldClasses}
          >
            <option value="EXTERNAL">External / per-token</option>
            <option value="SELF_HOSTED">Self-hosted / GPU allocation</option>
          </select>
        </Field>
        <Field label="Context window (tokens)">
          <input
            type="number"
            min={256}
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Max output tokens">
          <input
            type="number"
            min={1}
            value={maxOutputTokens}
            onChange={(event) => setMaxOutputTokens(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Quality score" hint="0–100, used by quality-first routing">
          <input
            type="number"
            min={0}
            max={100}
            value={qualityScore}
            onChange={(event) => setQualityScore(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Expected latency (ms)">
          <input
            type="number"
            min={1}
            value={expectedLatencyMs}
            onChange={(event) => setExpectedLatencyMs(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        {selfHosted ? (
          <Field label="GPU hourly cost (USD)" hint="Allocated from measured latency">
            <input
              type="number"
              step="0.01"
              min={0}
              value={gpuHourlyCostUsd}
              onChange={(event) => setGpuHourlyCostUsd(event.target.value)}
              className={fieldClasses}
            />
          </Field>
        ) : (
          <>
            <Field label="Input USD / 1M tokens">
              <input
                type="number"
                step="0.000001"
                min={0}
                value={inputPer1m}
                onChange={(event) => setInputPer1m(event.target.value)}
                className={fieldClasses}
              />
            </Field>
            <Field label="Output USD / 1M tokens">
              <input
                type="number"
                step="0.000001"
                min={0}
                value={outputPer1m}
                onChange={(event) => setOutputPer1m(event.target.value)}
                className={fieldClasses}
              />
            </Field>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <Toggle checked={supportsStreaming} onChange={setSupportsStreaming} label="Supports streaming" />
        <Toggle checked={supportsVision} onChange={setSupportsVision} label="Accepts image input" />
      </div>
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending}>Register model</SubmitButton>
    </form>
  );
}
