import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { generateApiKey } from "../src/common/crypto/api-key";
import { hashPassword } from "../src/common/crypto/password";
import { SecretCipher } from "../src/common/crypto/secret-cipher";

// The in-process rate limiter is used because REDIS_URL is empty in test/setup-env.ts.

const prisma = new PrismaClient();
const cipher = new SecretCipher(process.env.ENCRYPTION_KEY!);

interface Seeded {
  orgA: string;
  orgB: string;
  projectA: string;
  projectB: string;
  budgetProject: string;
  rateProject: string;
  keyA: string;
  keyB: string;
  keyBudget: string;
  keyRate: string;
  restrictedModel: string;
}

let app: INestApplication;
let seeded: Seeded;

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "UsageRecord", "CostRecord", "AiRequest", "Budget", "Alert",
      "ProjectApiKey", "ProjectModel", "ProjectProviderPreference", "Project",
      "RoutingPolicy", "ModelPricing", "ModelDeployment", "Model", "Provider",
      "Membership", "User", "Organization"
    CASCADE
  `);
}

async function createKey(projectId: string, scopes = ["*"]): Promise<string> {
  const generated = generateApiKey("live");
  await prisma.projectApiKey.create({
    data: {
      projectId,
      name: "e2e",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes,
    },
  });
  return generated.plaintext;
}

async function seed(): Promise<Seeded> {
  const orgA = await prisma.organization.create({
    data: { name: "Org A", slug: "org-a" },
  });
  const orgB = await prisma.organization.create({
    data: { name: "Org B", slug: "org-b" },
  });

  const passwordHash = hashPassword("test-password-123");
  const userA = await prisma.user.create({
    data: { email: "admin-a@test.dev", name: "Admin A", passwordHash },
  });
  const userB = await prisma.user.create({
    data: { email: "admin-b@test.dev", name: "Admin B", passwordHash },
  });
  await prisma.membership.createMany({
    data: [
      { orgId: orgA.id, userId: userA.id, role: "OWNER" },
      { orgId: orgB.id, userId: userB.id, role: "OWNER" },
    ],
  });

  const credentials = cipher.encryptJson({});
  const providerA = await prisma.provider.create({
    data: {
      orgId: orgA.id,
      name: "Mock A",
      slug: "mock",
      type: "MOCK",
      encryptedCredentials: credentials,
      priority: 5,
    },
  });
  const providerB = await prisma.provider.create({
    data: {
      orgId: orgB.id,
      name: "Mock B",
      slug: "mock",
      type: "MOCK",
      encryptedCredentials: credentials,
      priority: 5,
    },
  });

  const pricing = { inputPer1m: 0.02, outputPer1m: 0.04 };
  const chatModelA = await prisma.model.create({
    data: {
      orgId: orgA.id,
      providerId: providerA.id,
      slug: "mock-chat-small",
      displayName: "Mock Chat Small",
      modelType: "CHAT",
      externalModelId: "mock-chat-small",
      modalities: ["TEXT"],
      contextWindow: 32_768,
      maxOutputTokens: 4096,
      qualityScore: 35,
      expectedLatencyMs: 50,
      pricing: { create: { ...pricing, currency: "USD" } },
    },
  });
  const embedModelA = await prisma.model.create({
    data: {
      orgId: orgA.id,
      providerId: providerA.id,
      slug: "mock-embed-small",
      displayName: "Mock Embedding Small",
      modelType: "EMBEDDING",
      externalModelId: "mock-embed-small",
      modalities: ["TEXT"],
      contextWindow: 8192,
      maxOutputTokens: 1,
      qualityScore: 40,
      expectedLatencyMs: 20,
      pricing: { create: { currency: "USD", inputPer1m: 0.001, outputPer1m: 0 } },
    },
  });
  const restrictedModel = await prisma.model.create({
    data: {
      orgId: orgA.id,
      providerId: providerA.id,
      slug: "restricted-chat",
      displayName: "Restricted Chat",
      modelType: "CHAT",
      externalModelId: "mock-chat-small",
      modalities: ["TEXT"],
      contextWindow: 32_768,
      maxOutputTokens: 4096,
      qualityScore: 60,
      expectedLatencyMs: 60,
      pricing: { create: { ...pricing, currency: "USD" } },
    },
  });
  await prisma.model.create({
    data: {
      orgId: orgB.id,
      providerId: providerB.id,
      slug: "mock-chat-small",
      displayName: "Mock Chat Small (B)",
      modelType: "CHAT",
      externalModelId: "mock-chat-small",
      modalities: ["TEXT"],
      contextWindow: 32_768,
      maxOutputTokens: 4096,
      qualityScore: 35,
      expectedLatencyMs: 50,
      pricing: { create: { ...pricing, currency: "USD" } },
    },
  });

  const projectA = await prisma.project.create({
    data: {
      orgId: orgA.id,
      name: "Project A",
      slug: "project-a",
      allowedModalities: ["TEXT"],
      rateLimitRpm: 10_000,
      maxConcurrentRequests: 100,
      allowedModels: {
        create: [
          { modelId: chatModelA.id },
          { modelId: embedModelA.id },
          { modelId: restrictedModel.id },
        ],
      },
    },
  });
  const projectB = await prisma.project.create({
    data: {
      orgId: orgB.id,
      name: "Project B",
      slug: "project-b",
      allowedModalities: ["TEXT"],
      rateLimitRpm: 10_000,
      maxConcurrentRequests: 100,
      allowedModels: {
        create: [{ modelId: (await prisma.model.findFirstOrThrow({ where: { orgId: orgB.id } })).id }],
      },
    },
  });
  const budgetProject = await prisma.project.create({
    data: {
      orgId: orgA.id,
      name: "Budget Project",
      slug: "budget-project",
      allowedModalities: ["TEXT"],
      rateLimitRpm: 10_000,
      allowedModels: { create: [{ modelId: chatModelA.id }] },
      budgets: {
        create: {
          period: "DAILY",
          limitUsd: 0.0000001,
          softLimitPct: 80,
          hardLimit: true,
        },
      },
    },
  });
  const rateProject = await prisma.project.create({
    data: {
      orgId: orgA.id,
      name: "Rate Project",
      slug: "rate-project",
      allowedModalities: ["TEXT"],
      rateLimitRpm: 1,
      allowedModels: { create: [{ modelId: chatModelA.id }] },
    },
  });

  return {
    orgA: orgA.id,
    orgB: orgB.id,
    projectA: projectA.id,
    projectB: projectB.id,
    budgetProject: budgetProject.id,
    rateProject: rateProject.id,
    keyA: await createKey(projectA.id),
    keyB: await createKey(projectB.id),
    keyBudget: await createKey(budgetProject.id),
    keyRate: await createKey(rateProject.id),
    restrictedModel: restrictedModel.id,
  };
}

async function login(email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/admin/auth/login")
    .send({ email, password: "test-password-123" })
    .expect(201);
  return response.body.data.token;
}

beforeAll(async () => {
  await truncateAll();
  seeded = await seed();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe("health", () => {
  it("reports readiness with database connectivity", async () => {
    const response = await request(app.getHttpServer()).get("/health/ready").expect(200);
    expect(response.body.checks.database).toBe("up");
  });
});

describe("tenant isolation", () => {
  it("returns only the caller's organization projects", async () => {
    const tokenA = await login("admin-a@test.dev");
    const response = await request(app.getHttpServer())
      .get("/admin/projects")
      .set("authorization", `Bearer ${tokenA}`)
      .expect(200);
    const slugs = response.body.data.map((project: { slug: string }) => project.slug).sort();
    expect(slugs).toEqual(["budget-project", "project-a", "rate-project"]);
  });

  it("scopes the model catalog to the project allowlist", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("authorization", `Bearer ${seeded.keyB}`)
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe("mock-chat-small");
  });

  it("rejects a key from another tenant for admin routes", async () => {
    await request(app.getHttpServer())
      .get("/admin/projects")
      .set("authorization", `Bearer ${seeded.keyB}`)
      .expect(401);
  });

  it("refuses a model the project is not allowed to use", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyB}`)
      .send({
        model: "restricted-chat",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      })
      .expect(422);
    expect(response.body.error.code).toBe("model_not_available");
  });
});

describe("chat completions", () => {
  it("serves a non-streaming completion and meters cost", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyA}`)
      .send({
        model: "mock-chat-small",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 64,
      })
      .expect(200);
    expect(response.body.choices[0].message.content).toContain("[mock:mock-chat-small]");
    expect(response.body.ai_middleware.provider).toBe("Mock A");
    expect(response.body.usage.total_tokens).toBeGreaterThan(0);

    const stored = await prisma.aiRequest.findFirstOrThrow({
      where: { projectId: seeded.projectA },
      orderBy: { createdAt: "desc" },
    });
    expect(stored.status).toBe("SUCCEEDED");
    expect(Number(stored.costUsd)).toBeGreaterThan(0);
  });

  it("streams SSE chunks and terminates with [DONE]", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyA}`)
      .send({
        messages: [{ role: "user", content: "stream this" }],
        stream: true,
        max_tokens: 32,
      })
      .expect(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain("chat.completion.chunk");
    expect(response.text).toContain("data: [DONE]");
    const terminalChunks = response.text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line.includes('"finish_reason":"stop"'));
    expect(terminalChunks).toHaveLength(1);
  });

  it("returns embeddings for the embedding model", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/embeddings")
      .set("authorization", `Bearer ${seeded.keyA}`)
      .send({ input: ["alpha", "beta"], dimensions: 8 })
      .expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].embedding).toHaveLength(8);
  });

  it("records a failed call without billing it", async () => {
    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyA}`)
      .send({
        model: "mock-chat-small",
        messages: [{ role: "user", content: "__noretry__" }],
        max_tokens: 16,
      })
      .expect(502);
    const stored = await prisma.aiRequest.findFirstOrThrow({
      where: { projectId: seeded.projectA, status: "FAILED" },
      orderBy: { createdAt: "desc" },
    });
    expect(Number(stored.costUsd)).toBe(0);
  });
});

describe("budgets and rate limits", () => {
  it("blocks inference when a hard budget would be exceeded", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyBudget}`)
      .send({ messages: [{ role: "user", content: "spend" }], max_tokens: 10 })
      .expect(402);
    expect(response.body.error.code).toBe("budget_exceeded");
  });

  it("enforces the project requests-per-minute limit", async () => {
    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyRate}`)
      .send({ messages: [{ role: "user", content: "first" }], max_tokens: 10 })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${seeded.keyRate}`)
      .send({ messages: [{ role: "user", content: "second" }], max_tokens: 10 })
      .expect(429);
    expect(second.body.error.code).toBe("rate_limit_exceeded");
  });
});
