/* Development seed: creates a local organization, providers, models, routing
 * policies, projects, budgets and (optionally) demo usage. Never use the seeded
 * credentials in a shared or production environment. */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient, type ModelType, type Modality, type ProviderType } from "@prisma/client";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../.env") });

import { hashPassword } from "../src/common/crypto/password";
import { SecretCipher } from "../src/common/crypto/secret-cipher";
import { generateApiKey } from "../src/common/crypto/api-key";

const prisma = new PrismaClient();
const cipher = new SecretCipher(
  process.env.ENCRYPTION_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
);

function envFlag(name: string): boolean {
  return ["true", "1", "yes"].includes((process.env[name] ?? "").toLowerCase());
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ensurePricing(
  modelId: string,
  pricing: { input: number; output: number },
): Promise<void> {
  const existing = await prisma.modelPricing.findFirst({ where: { modelId } });
  if (existing) return;
  await prisma.modelPricing.create({
    data: {
      modelId,
      currency: "USD",
      inputPer1m: pricing.input,
      outputPer1m: pricing.output,
    },
  });
}

async function main(): Promise<void> {
  const orgName = process.env.SEED_ORG_NAME ?? "Local AI Platform";
  const org = await prisma.organization.upsert({
    where: { slug: "local-ai-platform" },
    create: { name: orgName, slug: "local-ai-platform" },
    update: { name: orgName },
  });

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@local.dev").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: "Platform Admin",
      passwordHash: hashPassword(adminPassword),
    },
    update: { passwordHash: hashPassword(adminPassword), isActive: true },
  });
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: admin.id } },
    create: { orgId: org.id, userId: admin.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  const providerInputs: Array<{
    name: string;
    slug: string;
    type: ProviderType;
    baseUrl?: string;
    credentials: Record<string, string>;
    status: "ACTIVE" | "DISABLED";
    priority: number;
  }> = [
    {
      name: "Built-in Mock",
      slug: "mock",
      type: "MOCK",
      credentials: {},
      status: "ACTIVE",
      priority: 5,
    },
    {
      name: "Ollama (local)",
      slug: "ollama",
      type: "OLLAMA",
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      credentials: {},
      status: envFlag("OLLAMA_ENABLED") ? "ACTIVE" : "DISABLED",
      priority: 20,
    },
    {
      name: "OpenAI",
      slug: "openai",
      type: "OPENAI",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      credentials: process.env.OPENAI_API_KEY
        ? { apiKey: process.env.OPENAI_API_KEY }
        : {},
      status: process.env.OPENAI_API_KEY ? "ACTIVE" : "DISABLED",
      priority: 30,
    },
    {
      name: "Anthropic",
      slug: "anthropic",
      type: "ANTHROPIC",
      credentials: process.env.ANTHROPIC_API_KEY
        ? { apiKey: process.env.ANTHROPIC_API_KEY }
        : {},
      status: process.env.ANTHROPIC_API_KEY ? "ACTIVE" : "DISABLED",
      priority: 30,
    },
    {
      name: "Google Gemini",
      slug: "gemini",
      type: "GEMINI",
      credentials: process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {},
      status: process.env.GEMINI_API_KEY ? "ACTIVE" : "DISABLED",
      priority: 30,
    },
  ];

  const providers = new Map<string, { id: string; type: ProviderType }>();
  for (const input of providerInputs) {
    const provider = await prisma.provider.upsert({
      where: { orgId_slug: { orgId: org.id, slug: input.slug } },
      create: {
        orgId: org.id,
        name: input.name,
        slug: input.slug,
        type: input.type,
        baseUrl: input.baseUrl,
        encryptedCredentials: cipher.encryptJson(input.credentials),
        status: input.status,
        priority: input.priority,
      },
      update: {
        name: input.name,
        baseUrl: input.baseUrl,
        encryptedCredentials: cipher.encryptJson(input.credentials),
        status: input.status,
        priority: input.priority,
      },
    });
    providers.set(input.slug, { id: provider.id, type: provider.type });
  }

  const modelInputs: Array<{
    slug: string;
    displayName: string;
    provider: string;
    modelType: ModelType;
    externalModelId: string;
    modalities: Modality[];
    contextWindow: number;
    maxOutputTokens: number;
    qualityScore: number;
    expectedLatencyMs: number;
    deploymentKind: "EXTERNAL" | "SELF_HOSTED";
    gpuHourlyCostUsd?: number;
    quantization?: string;
    pricing: { input: number; output: number };
    metadata?: Record<string, unknown>;
  }> = [
    {
      slug: "mock-chat-small",
      displayName: "Mock Chat Small",
      provider: "mock",
      modelType: "CHAT",
      externalModelId: "mock-chat-small",
      modalities: ["TEXT"],
      contextWindow: 32_768,
      maxOutputTokens: 4096,
      qualityScore: 35,
      expectedLatencyMs: 60,
      deploymentKind: "EXTERNAL",
      pricing: { input: 0.02, output: 0.04 },
    },
    {
      slug: "mock-embed-small",
      displayName: "Mock Embedding Small",
      provider: "mock",
      modelType: "EMBEDDING",
      externalModelId: "mock-embed-small",
      modalities: ["TEXT"],
      contextWindow: 8192,
      maxOutputTokens: 1,
      qualityScore: 40,
      expectedLatencyMs: 25,
      deploymentKind: "EXTERNAL",
      pricing: { input: 0.001, output: 0 },
    },
    {
      slug: "llama-3.1-8b-instruct",
      displayName: "Llama 3.1 8B Instruct (vLLM/Ollama)",
      provider: "ollama",
      modelType: "CHAT",
      externalModelId: "llama3.1:8b",
      modalities: ["TEXT"],
      contextWindow: 131_072,
      maxOutputTokens: 8192,
      qualityScore: 62,
      expectedLatencyMs: 700,
      deploymentKind: "SELF_HOSTED",
      gpuHourlyCostUsd: 0.65,
      quantization: "Q4_K_M",
      pricing: { input: 0, output: 0 },
      metadata: { serving_notes: "vLLM in production, Ollama for local development" },
    },
    {
      slug: "gpt-4o-mini",
      displayName: "GPT-4o mini",
      provider: "openai",
      modelType: "CHAT",
      externalModelId: "gpt-4o-mini",
      modalities: ["TEXT", "IMAGE"],
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      qualityScore: 80,
      expectedLatencyMs: 850,
      deploymentKind: "EXTERNAL",
      pricing: { input: 0.15, output: 0.6 },
    },
    {
      slug: "text-embedding-3-small",
      displayName: "Text Embedding 3 Small",
      provider: "openai",
      modelType: "EMBEDDING",
      externalModelId: "text-embedding-3-small",
      modalities: ["TEXT"],
      contextWindow: 8191,
      maxOutputTokens: 1,
      qualityScore: 76,
      expectedLatencyMs: 300,
      deploymentKind: "EXTERNAL",
      pricing: { input: 0.02, output: 0 },
    },
    {
      slug: "claude-3-5-haiku",
      displayName: "Claude 3.5 Haiku",
      provider: "anthropic",
      modelType: "CHAT",
      externalModelId: "claude-3-5-haiku-latest",
      modalities: ["TEXT", "IMAGE"],
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      qualityScore: 82,
      expectedLatencyMs: 1100,
      deploymentKind: "EXTERNAL",
      pricing: { input: 0.8, output: 4 },
    },
    {
      slug: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      provider: "gemini",
      modelType: "CHAT",
      externalModelId: "gemini-2.0-flash",
      modalities: ["TEXT", "IMAGE"],
      contextWindow: 1_000_000,
      maxOutputTokens: 8192,
      qualityScore: 78,
      expectedLatencyMs: 650,
      deploymentKind: "EXTERNAL",
      pricing: { input: 0.1, output: 0.4 },
    },
  ];

  const models = new Map<string, { id: string; modelType: ModelType }>();
  for (const input of modelInputs) {
    const provider = providers.get(input.provider)!;
    const model = await prisma.model.upsert({
      where: { orgId_slug: { orgId: org.id, slug: input.slug } },
      create: {
        orgId: org.id,
        providerId: provider.id,
        slug: input.slug,
        displayName: input.displayName,
        modelType: input.modelType,
        externalModelId: input.externalModelId,
        modalities: input.modalities,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        qualityScore: input.qualityScore,
        expectedLatencyMs: input.expectedLatencyMs,
        deploymentKind: input.deploymentKind,
        gpuHourlyCostUsd: input.gpuHourlyCostUsd,
        quantization: input.quantization,
        metadata: (input.metadata ?? {}) as never,
      },
      update: {
        providerId: provider.id,
        displayName: input.displayName,
        externalModelId: input.externalModelId,
        modalities: input.modalities,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        qualityScore: input.qualityScore,
        expectedLatencyMs: input.expectedLatencyMs,
        deploymentKind: input.deploymentKind,
        gpuHourlyCostUsd: input.gpuHourlyCostUsd,
        quantization: input.quantization,
        metadata: (input.metadata ?? {}) as never,
      },
    });
    models.set(input.slug, { id: model.id, modelType: model.modelType });
    await ensurePricing(model.id, input.pricing);
  }

  const chatModelIds = ["mock-chat-small", "llama-3.1-8b-instruct", "gpt-4o-mini", "claude-3-5-haiku", "gemini-2.0-flash"].map(
    (slug) => models.get(slug)!.id,
  );
  const embeddingModelIds = ["mock-embed-small", "text-embedding-3-small"].map(
    (slug) => models.get(slug)!.id,
  );
  const allModelIds = [...chatModelIds, ...embeddingModelIds];

  const policies = [
    {
      name: "Balanced",
      slug: "balanced",
      kind: "CUSTOM_WEIGHTED" as const,
      isDefault: true,
      description: "Default cost/latency/quality balance",
      config: { weights: { cost: 0.35, latency: 0.25, quality: 0.4 } },
    },
    {
      name: "Cheapest",
      slug: "cheapest",
      kind: "CHEAPEST" as const,
      isDefault: false,
      description: "Minimise estimated spend",
      config: {},
    },
    {
      name: "Lowest latency",
      slug: "lowest-latency",
      kind: "LOWEST_LATENCY" as const,
      isDefault: false,
      description: "Minimise expected time to response",
      config: {},
    },
    {
      name: "Highest quality",
      slug: "highest-quality",
      kind: "HIGHEST_QUALITY" as const,
      isDefault: false,
      description: "Prefer the best available model",
      config: {},
    },
    {
      name: "Preferred with fallback",
      slug: "preferred",
      kind: "PREFERRED_FALLBACK" as const,
      isDefault: false,
      description: "Try the preferred model, then fall back",
      config: { preferredModelIds: [chatModelIds[2], chatModelIds[3], chatModelIds[0]] },
    },
    {
      name: "Task based",
      slug: "task-based",
      kind: "TASK_BASED" as const,
      isDefault: false,
      description: "Task-specific model preferences",
      config: {
        taskModelMap: {
          classification: [chatModelIds[0], chatModelIds[2]],
          summarization: [chatModelIds[2], chatModelIds[4]],
          reasoning: [chatModelIds[3], chatModelIds[4], chatModelIds[2]],
        },
      },
    },
  ];

  const policyBySlug = new Map<string, string>();
  for (const input of policies) {
    const policy = await prisma.routingPolicy.upsert({
      where: { orgId_slug: { orgId: org.id, slug: input.slug } },
      create: {
        orgId: org.id,
        name: input.name,
        slug: input.slug,
        kind: input.kind,
        description: input.description,
        isDefault: input.isDefault,
        config: input.config,
      },
      update: {
        name: input.name,
        kind: input.kind,
        description: input.description,
        config: input.config,
      },
    });
    policyBySlug.set(input.slug, policy.id);
  }
  await prisma.routingPolicy.updateMany({
    where: { orgId: org.id, isDefault: true, slug: { not: "balanced" } },
    data: { isDefault: false },
  });

  const projects = [
    {
      name: "Support Bot",
      slug: "support-bot",
      description: "Customer support assistant with streaming chat",
      policy: "balanced",
      budgets: { monthly: 50, daily: 5 },
    },
    {
      name: "Content Studio",
      slug: "content-studio",
      description: "Long-form content generation and summarisation",
      policy: "cheapest",
      budgets: { monthly: 200, daily: 20 },
    },
    {
      name: "Research Lab",
      slug: "research-lab",
      description: "High-quality reasoning experiments",
      policy: "highest-quality",
      budgets: { monthly: 100, daily: 10 },
    },
  ];

  const devKeys: Array<{ project: string; key: string }> = [];

  for (const input of projects) {
    const project = await prisma.project.upsert({
      where: { orgId_slug: { orgId: org.id, slug: input.slug } },
      create: {
        orgId: org.id,
        name: input.name,
        slug: input.slug,
        description: input.description,
        defaultPolicyId: policyBySlug.get(input.policy),
        allowedModalities: ["TEXT"],
      },
      update: {
        name: input.name,
        description: input.description,
        defaultPolicyId: policyBySlug.get(input.policy),
        allowedModalities: ["TEXT"],
      },
    });

    await prisma.projectModel.createMany({
      data: allModelIds.map((modelId) => ({ projectId: project.id, modelId })),
      skipDuplicates: true,
    });

    await prisma.budget.upsert({
      where: { projectId_period: { projectId: project.id, period: "MONTHLY" } },
      create: {
        projectId: project.id,
        period: "MONTHLY",
        limitUsd: input.budgets.monthly,
        softLimitPct: 80,
        hardLimit: true,
      },
      update: { limitUsd: input.budgets.monthly, hardLimit: true },
    });
    await prisma.budget.upsert({
      where: { projectId_period: { projectId: project.id, period: "DAILY" } },
      create: {
        projectId: project.id,
        period: "DAILY",
        limitUsd: input.budgets.daily,
        softLimitPct: 80,
        hardLimit: true,
      },
      update: { limitUsd: input.budgets.daily, hardLimit: true },
    });

    const existingKey = await prisma.projectApiKey.findFirst({
      where: { projectId: project.id, revokedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (!existingKey) {
      const generated = generateApiKey("live");
      await prisma.projectApiKey.create({
        data: {
          projectId: project.id,
          name: "Development key",
          prefix: generated.prefix,
          keyHash: generated.keyHash,
          scopes: ["*"],
          createdBy: admin.id,
        },
      });
      devKeys.push({ project: input.slug, key: generated.plaintext });
    }
  }

  if (envFlag("SEED_DEMO_USAGE")) {
    const existingDemo = await prisma.aiRequest.count({
      where: { orgId: org.id, routingDecision: { path: ["seeded"], equals: true } },
    });
    if (existingDemo === 0) {
      const random = rng(42);
      const demoProjects = await prisma.project.findMany({
        where: { orgId: org.id },
        include: { allowedModels: { include: { model: { include: { pricing: true, provider: true } } } } },
      });
      let created = 0;
      for (const project of demoProjects) {
        const chatModels = project.allowedModels
          .map((entry) => entry.model)
          .filter((model) => model.modelType === "CHAT");
        for (let day = 13; day >= 0; day -= 1) {
          const requestsToday = 3 + Math.floor(random() * 8);
          for (let index = 0; index < requestsToday; index += 1) {
            const model = chatModels[Math.floor(random() * chatModels.length)];
            if (!model) continue;
            const pricing = model.pricing[0];
            const inputTokens = 200 + Math.floor(random() * 1800);
            const outputTokens = 80 + Math.floor(random() * 700);
            const latencyMs = Math.floor(model.expectedLatencyMs * (0.6 + random() * 1.2));
            const failed = random() < 0.04;
            const ts = new Date(Date.now() - day * 86_400_000 - Math.floor(random() * 86_400_000));
            const inference = pricing
              ? (Number(pricing.inputPer1m) * inputTokens + Number(pricing.outputPer1m) * outputTokens) /
                1_000_000
              : 0;
            const gpuMs = model.deploymentKind === "SELF_HOSTED" ? latencyMs : 0;
            const gpuCost =
              model.gpuHourlyCostUsd && gpuMs
                ? (Number(model.gpuHourlyCostUsd) * gpuMs) / 3_600_000
                : 0;
            const cost = failed ? 0 : inference + gpuCost;
            await prisma.aiRequest.create({
              data: {
                traceId: randomUUID(),
                orgId: org.id,
                projectId: project.id,
                providerId: model.providerId,
                modelId: model.id,
                endpoint: "/v1/chat/completions",
                status: failed ? "FAILED" : "SUCCEEDED",
                httpStatus: failed ? 502 : 200,
                routingDecision: {
                  seeded: true,
                  policy: { name: "seed", kind: "CUSTOM_WEIGHTED" },
                  baselineCostUsd: cost * (1.3 + random()),
                  selected: { model: model.slug, provider: model.provider.name },
                },
                inputTokens,
                outputTokens: failed ? 0 : outputTokens,
                totalTokens: failed ? inputTokens : inputTokens + outputTokens,
                costUsd: cost,
                latencyMs,
                ttftMs: Math.floor(latencyMs * 0.25),
                retryCount: failed ? 1 : 0,
                fallbackUsed: failed,
                errorCode: failed ? "provider_unavailable" : null,
                createdAt: ts,
                usage: {
                  create: {
                    projectId: project.id,
                    providerId: model.providerId,
                    modelId: model.id,
                    pricingId: pricing?.id,
                    inputTokens,
                    outputTokens: failed ? 0 : outputTokens,
                    gpuMs,
                    costUsd: cost,
                    createdAt: ts,
                  },
                },
                costs: {
                  create: [
                    ...(inference > 0 && !failed
                      ? [
                          {
                            projectId: project.id,
                            providerId: model.providerId,
                            modelId: model.id,
                            pricingId: pricing?.id,
                            kind: "INFERENCE",
                            amountUsd: inference,
                            createdAt: ts,
                          },
                        ]
                      : []),
                    ...(gpuCost > 0 && !failed
                      ? [
                          {
                            projectId: project.id,
                            providerId: model.providerId,
                            modelId: model.id,
                            kind: "GPU",
                            amountUsd: gpuCost,
                            createdAt: ts,
                          },
                        ]
                      : []),
                  ],
                },
              },
            });
            created += 1;
          }
        }
      }
      console.log(`Seeded ${created} demo requests (SEED_DEMO_USAGE=true).`);
    } else {
      console.log("Demo usage already present; skipping regeneration.");
    }
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log("Seed complete");
  console.log(`  Organization : ${org.name} (${org.slug})`);
  console.log(`  Admin login  : ${adminEmail} / ${adminPassword}`);
  console.log(`  Models       : ${modelInputs.length}`);
  console.log(`  Projects     : ${projects.map((project) => project.slug).join(", ")}`);
  if (devKeys.length > 0) {
    console.log("\n  New development API keys (shown once):");
    for (const entry of devKeys) {
      console.log(`    ${entry.project.padEnd(16)} ${entry.key}`);
    }
  } else {
    console.log("\n  Existing API keys retained (plaintext is not recoverable).");
    console.log("  Rotate a key from the dashboard or POST /admin/projects/:id/keys.");
  }
  console.log("──────────────────────────────────────────────────────────\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
