"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/client";
import type { ApiKey } from "@/lib/types";
import { badgeForScopes } from "@/lib/scopes";
import { Badge, buttonClasses, fieldClasses } from "../ui";
import {
  CheckboxGroup,
  CopyButton,
  Feedback,
  Field,
  SubmitButton,
  Toggle,
  useAction,
} from "./form-kit";

interface Option {
  id: string;
  label: string;
}

export function CreateProjectForm({
  policies,
  models,
}: {
  policies: Option[];
  models: Option[];
}) {
  const { pending, error, notice, run, setError } = useAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [rpm, setRpm] = useState("600");
  const [modelIds, setModelIds] = useState<string[]>([]);

  function toggleModel(value: string, checked: boolean) {
    setModelIds((current) =>
      checked ? [...current, value] : current.filter((id) => id !== value),
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (modelIds.length === 0) {
          setError("Select at least one model — a project without models cannot route.");
          return;
        }
        run(async () => {
          await adminFetch("projects", {
            method: "POST",
            body: JSON.stringify({
              name,
              description: description || undefined,
              defaultPolicyId: policyId || undefined,
              rateLimitRpm: rpm ? Number(rpm) : undefined,
              allowedModelIds: modelIds,
            }),
          });
          setName("");
          setDescription("");
          setPolicyId("");
          setModelIds([]);
          return "Project created and ready for API keys.";
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
            placeholder="Search assistant"
          />
        </Field>
        <Field label="Requests per minute" hint="Hard RPM limit enforced at the gateway">
          <input
            type="number"
            min={1}
            value={rpm}
            onChange={(event) => setRpm(event.target.value)}
            className={fieldClasses}
          />
        </Field>
      </div>
      <Field label="Description">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={fieldClasses}
          placeholder="Team, workload, or escalation owner"
        />
      </Field>
      <Field label="Default routing policy" hint="Leave empty to inherit the organisation default">
        <select
          value={policyId}
          onChange={(event) => setPolicyId(event.target.value)}
          className={fieldClasses}
        >
          <option value="">Organisation default</option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.label}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Allowed models
        </span>
        <CheckboxGroup
          options={models.map((model) => ({ value: model.id, label: model.label }))}
          selected={modelIds}
          onToggle={toggleModel}
        />
      </div>
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending}>Create project</SubmitButton>
    </form>
  );
}

const SCOPE_OPTIONS = [
  { value: "chat", label: "Chat" },
  { value: "embeddings", label: "Embeddings" },
  { value: "images", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "jobs", label: "Background jobs" },
  { value: "rag", label: "RAG" },
];

function RevealedKey({ value }: { value: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-amber-200">
        Copy this key now — it is never shown again
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="scrollbar-thin flex-1 overflow-x-auto rounded bg-black/30 px-2 py-1.5 font-mono text-xs text-amber-100">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function CreateKeyForm({ projectId }: { projectId: string }) {
  const { pending, error, notice, run } = useAction();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["chat", "embeddings"]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          const response = await adminFetch<{ data: ApiKey & { key: string } }>(
            `projects/${projectId}/keys`,
            {
              method: "POST",
              body: JSON.stringify({
                name,
                scopes: scopes.length > 0 ? scopes : ["chat"],
                expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
              }),
            },
          );
          setCreated(response.data.key);
          setName("");
          return "API key created.";
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Key name">
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClasses}
            placeholder="production"
          />
        </Field>
        <Field label="Expires in days" hint="Leave empty for no expiry">
          <input
            type="number"
            min={1}
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
            className={fieldClasses}
            placeholder="365"
          />
        </Field>
      </div>
      <div>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Scopes
        </span>
        <CheckboxGroup
          options={SCOPE_OPTIONS}
          selected={scopes}
          onToggle={(value, checked) =>
            setScopes((current) =>
              checked ? [...current, value] : current.filter((scope) => scope !== value),
            )
          }
        />
      </div>
      {created ? <RevealedKey value={created} /> : null}
      <Feedback error={error} notice={notice} />
      <SubmitButton pending={pending}>Create API key</SubmitButton>
    </form>
  );
}

export function KeyActions({
  projectId,
  apiKey,
}: {
  projectId: string;
  apiKey: ApiKey;
}) {
  const { pending, error, notice, run } = useAction();
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const revoked = Boolean(apiKey.revokedAt);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {apiKey.scopes.map((scope) => (
          <Badge key={scope} tone="blue">
            {badgeForScopes(scope)}
          </Badge>
        ))}
        {revoked ? <Badge tone="rose">revoked</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || revoked}
          onClick={() =>
            run(async () => {
              const response = await adminFetch<{ data: ApiKey & { key: string } }>(
                `projects/${projectId}/keys/${apiKey.id}/rotate`,
                { method: "POST" },
              );
              setRotatedKey(response.data.key);
              return "Key rotated. The previous secret is revoked.";
            })
          }
          className={buttonClasses.secondary}
        >
          Rotate
        </button>
        <button
          type="button"
          disabled={pending || revoked}
          onClick={() => {
            if (!window.confirm(`Revoke API key "${apiKey.name}"? This cannot be undone.`)) return;
            run(async () => {
              await adminFetch(`projects/${projectId}/keys/${apiKey.id}/revoke`, {
                method: "POST",
              });
              return "Key revoked.";
            });
          }}
          className={buttonClasses.danger}
        >
          Revoke
        </button>
      </div>
      {rotatedKey ? <RevealedKey value={rotatedKey} /> : null}
      <Feedback error={error} notice={notice} />
    </div>
  );
}

export function ProjectStatusToggle({
  projectId,
  status,
}: {
  projectId: string;
  status: string;
}) {
  const { pending, run } = useAction();
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClasses.secondary}
      onClick={() =>
        run(async () => {
          await adminFetch(`projects/${projectId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: next }),
          });
          return next === "ACTIVE" ? "Project resumed." : "Project suspended.";
        })
      }
    >
      {status === "ACTIVE" ? "Suspend project" : "Activate project"}
    </button>
  );
}

export { Toggle };
