import type { Modality, RoutingPolicyKind } from "@ai-mw/contracts";

export interface RoutingCandidate {
  modelId: string;
  modelSlug: string;
  displayName: string;
  externalModelId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  providerStatus: string;
  providerPriority: number;
  modelStatus: string;
  modelType: "CHAT" | "EMBEDDING" | "IMAGE" | "AUDIO_TRANSCRIPTION" | "AUDIO_SPEECH" | "VIDEO";
  deploymentKind: "EXTERNAL" | "SELF_HOSTED";
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  modalities: Modality[];
  qualityScore: number;
  expectedLatencyMs: number;
  inputPer1m: number | null;
  outputPer1m: number | null;
  gpuHourlyCostUsd: number | null;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
}

export interface RoutingHints {
  modality: Modality;
  modelType: "CHAT" | "EMBEDDING" | "IMAGE" | "AUDIO_TRANSCRIPTION" | "AUDIO_SPEECH" | "VIDEO";
  requiresStreaming: boolean;
  inputTokens: number;
  maxOutputTokens: number;
  task?: string;
  preferredSlugs?: string[];
  quality?: "low" | "balanced" | "high";
  maxCostUsd?: number;
  maxLatencyMs?: number;
}

export interface PolicySnapshot {
  id: string | null;
  name: string;
  kind: RoutingPolicyKind;
  config: {
    preferredModelId?: string;
    preferredModelIds?: string[];
    fallbackModelIds?: string[];
    taskModelMap?: Record<string, string[]>;
    weights?: { cost: number; latency: number; quality: number };
    maxCostUsd?: number;
  };
}

export interface ScoredCandidate {
  candidate: RoutingCandidate;
  score: number;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  reasons: string[];
  excluded?: string;
}

export interface RoutingDecision {
  policy: PolicySnapshot;
  selected: ScoredCandidate | null;
  ranked: ScoredCandidate[];
  excluded: Array<{ candidate: RoutingCandidate; reasons: string[] }>;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  explanation: string;
}

const DEFAULT_POLICY: PolicySnapshot = {
  id: null,
  name: "balanced-default",
  kind: "CUSTOM_WEIGHTED",
  config: { weights: { cost: 0.35, latency: 0.25, quality: 0.4 } },
};

export function estimateCandidateCostUsd(
  candidate: Pick<
    RoutingCandidate,
    "inputPer1m" | "outputPer1m" | "gpuHourlyCostUsd" | "expectedLatencyMs" | "deploymentKind"
  >,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const hasTokenPricing = candidate.inputPer1m !== null || candidate.outputPer1m !== null;
  if (!hasTokenPricing && candidate.gpuHourlyCostUsd === null) return null;
  const tokenCost =
    ((candidate.inputPer1m ?? 0) * inputTokens + (candidate.outputPer1m ?? 0) * outputTokens) /
    1_000_000;
  const gpuCost =
    candidate.gpuHourlyCostUsd !== null
      ? (candidate.gpuHourlyCostUsd * Math.max(candidate.expectedLatencyMs, 1)) / 3_600_000
      : 0;
  return Number((tokenCost + gpuCost).toFixed(7));
}

function preferenceOrder(policy: PolicySnapshot, hints: RoutingHints): string[] {
  const configured = [
    ...(policy.config.preferredModelIds ?? []),
    ...(policy.config.preferredModelId ? [policy.config.preferredModelId] : []),
  ];
  const taskPreferred = hints.task ? (policy.config.taskModelMap?.[hints.task] ?? []) : [];
  return [...(hints.preferredSlugs ?? []), ...taskPreferred, ...configured];
}

/**
 * Deterministic, explainable routing over an already tenant-filtered candidate
 * set. This function performs no I/O, which makes every policy unit-testable.
 */
export function route(
  candidates: RoutingCandidate[],
  hints: RoutingHints,
  policyInput: PolicySnapshot = DEFAULT_POLICY,
  now = Date.now(),
): RoutingDecision {
  const policy = policyInput ?? DEFAULT_POLICY;
  const requiredTokens = hints.inputTokens + hints.maxOutputTokens;
  const evaluated: ScoredCandidate[] = [];
  const excluded: Array<{ candidate: RoutingCandidate; reasons: string[] }> = [];

  for (const candidate of candidates) {
    const reasons: string[] = [];

    if (candidate.modelStatus === "OFFLINE") reasons.push("model is offline");
    if (candidate.modelType !== hints.modelType) {
      reasons.push(`model type ${candidate.modelType} does not match ${hints.modelType}`);
    }
    if (candidate.providerStatus === "DISABLED") reasons.push("provider is disabled");
    if (candidate.circuitState === "OPEN") reasons.push("provider circuit is open");
    if (!candidate.modalities.includes(hints.modality)) {
      reasons.push(`does not support ${hints.modality.toLowerCase()} modality`);
    }
    if (hints.requiresStreaming && !candidate.supportsStreaming) {
      reasons.push("does not support streaming");
    }
    if (candidate.contextWindow < requiredTokens) {
      reasons.push(
        `context window ${candidate.contextWindow} < required ${requiredTokens} tokens`,
      );
    }
    const cost = estimateCandidateCostUsd(
      candidate,
      hints.inputTokens,
      Math.min(hints.maxOutputTokens, candidate.maxOutputTokens),
    );
    if (cost === null) reasons.push("no pricing or GPU cost configured (cannot account)");
    if (hints.maxCostUsd !== undefined && cost !== null && cost > hints.maxCostUsd) {
      reasons.push(`estimated cost exceeds requested max_cost_usd (${hints.maxCostUsd})`);
    }
    if (hints.maxLatencyMs !== undefined && candidate.expectedLatencyMs > hints.maxLatencyMs * 2) {
      reasons.push("expected latency far exceeds requested maximum");
    }

    if (reasons.length > 0) {
      excluded.push({ candidate, reasons });
      continue;
    }

    evaluated.push({
      candidate,
      score: 0,
      estimatedCostUsd: cost ?? 0,
      estimatedLatencyMs: candidate.expectedLatencyMs,
      reasons,
    });
  }

  if (evaluated.length === 0) {
    return {
      policy,
      selected: null,
      ranked: [],
      excluded,
      estimatedInputTokens: hints.inputTokens,
      estimatedOutputTokens: hints.maxOutputTokens,
      estimatedCostUsd: 0,
      explanation: "No candidate model satisfied capability, availability and pricing constraints",
    };
  }

  const preferred = preferenceOrder(policy, hints);
  const preferenceIndex = new Map<string, number>();
  preferred.forEach((reference, index) => {
    if (!preferenceIndex.has(reference)) preferenceIndex.set(reference, index);
  });

  const maxCost = Math.max(...evaluated.map((entry) => entry.estimatedCostUsd), 1e-9);
  const maxLatency = Math.max(...evaluated.map((entry) => entry.estimatedLatencyMs), 1);

  for (const entry of evaluated) {
    const { candidate } = entry;
    const normalizedCost = entry.estimatedCostUsd / maxCost;
    const normalizedLatency = entry.estimatedLatencyMs / maxLatency;
    const qualityPenalty = 1 - candidate.qualityScore / 100;
    const providerPenalty = candidate.providerPriority / 10_000;
    const halfOpenPenalty = candidate.circuitState === "HALF_OPEN" ? 0.05 : 0;

    let baseScore: number;
    switch (policy.kind) {
      case "CHEAPEST":
        baseScore = normalizedCost * 0.9 + qualityPenalty * 0.1;
        entry.reasons.push("optimised for lowest estimated cost");
        break;
      case "LOWEST_LATENCY":
        baseScore = normalizedLatency * 0.9 + normalizedCost * 0.1;
        entry.reasons.push("optimised for lowest expected latency");
        break;
      case "HIGHEST_QUALITY":
        baseScore = qualityPenalty * 0.85 + normalizedLatency * 0.1 + normalizedCost * 0.05;
        entry.reasons.push("optimised for highest quality score");
        break;
      case "PREFERRED_FALLBACK":
      case "TASK_BASED": {
        const preference = preferenceIndex.get(candidate.modelSlug) ?? preferenceIndex.get(candidate.modelId);
        baseScore = preference !== undefined ? preference / 100 : 1 + qualityPenalty;
        entry.reasons.push(
          preference !== undefined
            ? `position ${preference + 1} in policy preference list`
            : "fallback ordered by quality",
        );
        break;
      }
      case "CUSTOM_WEIGHTED":
      default: {
        const weights = policy.config.weights ?? { cost: 0.35, latency: 0.25, quality: 0.4 };
        const total = weights.cost + weights.latency + weights.quality || 1;
        baseScore =
          (weights.cost * normalizedCost +
            weights.latency * normalizedLatency +
            weights.quality * qualityPenalty) /
          total;
        entry.reasons.push(
          `weighted score (cost ${weights.cost}, latency ${weights.latency}, quality ${weights.quality})`,
        );
      }
    }

    const explicitPreference = preferenceIndex.get(candidate.modelSlug) ?? preferenceIndex.get(candidate.modelId);
    if (explicitPreference !== undefined && policy.kind !== "PREFERRED_FALLBACK" && policy.kind !== "TASK_BASED") {
      baseScore -= 0.2 / (explicitPreference + 1);
      entry.reasons.push("matches an explicitly preferred model");
    }

    entry.score = Number((baseScore + providerPenalty + halfOpenPenalty).toFixed(6));

    if (hints.quality === "high" && candidate.qualityScore < 65) {
      entry.score += 0.15;
      entry.reasons.push("quality hint is high; lower-quality model penalised");
    }
    if (hints.quality === "low" && candidate.qualityScore > 85) {
      entry.score += 0.05;
      entry.reasons.push("quality hint is low; premium model penalised");
    }
    if (candidate.deploymentKind === "SELF_HOSTED") {
      entry.reasons.push("self-hosted GPU cost allocated from hourly rate and latency");
    }
  }

  evaluated.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.candidate.qualityScore !== b.candidate.qualityScore) {
      return b.candidate.qualityScore - a.candidate.qualityScore;
    }
    if (a.estimatedCostUsd !== b.estimatedCostUsd) {
      return a.estimatedCostUsd - b.estimatedCostUsd;
    }
    return a.candidate.modelId.localeCompare(b.candidate.modelId);
  });

  const selected = evaluated[0];
  const explanation = selected
    ? `Selected ${selected.candidate.displayName} via ${selected.candidate.providerName} using ${policy.name}: ` +
      `${selected.reasons.join("; ")}. Estimated cost $${selected.estimatedCostUsd.toFixed(6)}.`
    : "No candidate model satisfied constraints";

  return {
    policy,
    selected,
    ranked: evaluated,
    excluded,
    estimatedInputTokens: hints.inputTokens,
    estimatedOutputTokens: hints.maxOutputTokens,
    estimatedCostUsd: selected?.estimatedCostUsd ?? 0,
    explanation,
  };
}

export { DEFAULT_POLICY };
