/* Idempotent onboarding for a product organisation.
 *
 * Creates (or updates) the admin account, one gateway project per product,
 * budgets and an application API key. It never writes request, usage or cost
 * rows: all consumption comes from real provider traffic. Re-running it rotates
 * the admin password if ONBOARD_ADMIN_PASSWORD is set, and leaves existing API
 * keys alone (their plaintext cannot be recovered).
 *
 *   ONBOARD_ORG_NAME="ScienceWerx" \
 *   ONBOARD_ADMIN_EMAIL="admin@sciencewerx.org" \
 *   ONBOARD_ADMIN_PASSWORD="…" \
 *   ONBOARD_PROJECTS="sciencewerx:ScienceWerx,morewerx:MoreWerx" \
 *   pnpm onboard
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient, type ProjectStatus } from "@prisma/client";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../.env") });

import { hashPassword } from "../src/common/crypto/password";
import { generateApiKey } from "../src/common/crypto/api-key";

const prisma = new PrismaClient();

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseProjects(value: string): Array<{ slug: string; name: string }> {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [slug, name] = entry.split(":").map((part) => part.trim());
      return { slug, name: name || slug };
    });
}

async function main(): Promise<void> {
  const orgSlug = process.env.ONBOARD_ORG_SLUG ?? "local-ai-platform";
  const orgName = process.env.ONBOARD_ORG_NAME ?? "ScienceWerx";
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    create: { name: orgName, slug: orgSlug },
    update: { name: orgName },
  });

  const adminEmail = (process.env.ONBOARD_ADMIN_EMAIL ?? "admin@sciencewerx.org").toLowerCase().trim();
  const generatedPassword = !process.env.ONBOARD_ADMIN_PASSWORD;
  const adminPassword = process.env.ONBOARD_ADMIN_PASSWORD ?? randomBytes(18).toString("base64url");
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: process.env.ONBOARD_ADMIN_NAME ?? "ScienceWerx Admin",
      passwordHash: hashPassword(adminPassword),
    },
    update: { passwordHash: hashPassword(adminPassword), isActive: true },
  });
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: admin.id } },
    create: { orgId: org.id, userId: admin.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  const defaultPolicy = await prisma.routingPolicy.findFirst({
    where: { orgId: org.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!defaultPolicy) {
    console.warn("No routing policy exists for this organisation; create one in the dashboard.");
  }

  const models = await prisma.model.findMany({
    where: { orgId: org.id, provider: { type: { not: "MOCK" } } },
  });
  if (models.length === 0) {
    console.warn(
      "No real models are registered for this organisation. Register providers/models in the dashboard before sending traffic.",
    );
  }

  const projectInputs = parseProjects(
    process.env.ONBOARD_PROJECTS ?? "sciencewerx:ScienceWerx,morewerx:MoreWerx",
  );
  const monthlyBudget = numberEnv("ONBOARD_MONTHLY_BUDGET_USD", 500);
  const dailyBudget = numberEnv("ONBOARD_DAILY_BUDGET_USD", 25);

  const issuedKeys: Array<{ project: string; key: string }> = [];

  for (const input of projectInputs) {
    const project = await prisma.project.upsert({
      where: { orgId_slug: { orgId: org.id, slug: input.slug } },
      create: {
        orgId: org.id,
        name: input.name,
        slug: input.slug,
        description: `${input.name} production traffic through the AI gateway`,
        status: "ACTIVE" as ProjectStatus,
        defaultPolicyId: defaultPolicy?.id,
        allowedModalities: ["TEXT"],
      },
      update: {
        name: input.name,
        status: "ACTIVE" as ProjectStatus,
        defaultPolicyId: defaultPolicy?.id ?? undefined,
        allowedModalities: ["TEXT"],
      },
    });

    if (models.length > 0) {
      await prisma.projectModel.createMany({
        data: models.map((model) => ({ projectId: project.id, modelId: model.id })),
        skipDuplicates: true,
      });
    }

    for (const [period, limitUsd] of [
      ["MONTHLY", monthlyBudget],
      ["DAILY", dailyBudget],
    ] as const) {
      await prisma.budget.upsert({
        where: { projectId_period: { projectId: project.id, period } },
        create: { projectId: project.id, period, limitUsd, softLimitPct: 80, hardLimit: true },
        update: { limitUsd, softLimitPct: 80, hardLimit: true, isActive: true },
      });
    }

    const activeKey = await prisma.projectApiKey.findFirst({
      where: { projectId: project.id, revokedAt: null },
    });
    if (!activeKey) {
      const generated = generateApiKey("live");
      await prisma.projectApiKey.create({
        data: {
          projectId: project.id,
          name: "Application key",
          prefix: generated.prefix,
          keyHash: generated.keyHash,
          scopes: ["chat", "embeddings"],
          createdBy: admin.id,
        },
      });
      issuedKeys.push({ project: input.slug, key: generated.plaintext });
    }
  }

  const archive = (process.env.ONBOARD_ARCHIVE_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug && !projectInputs.some((project) => project.slug === slug));
  if (archive.length > 0) {
    const archived = await prisma.project.updateMany({
      where: { orgId: org.id, slug: { in: archive } },
      data: { status: "ARCHIVED" },
    });
    if (archived.count > 0) console.log(`Archived ${archived.count} project(s): ${archive.join(", ")}`);
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log("Onboarding complete");
  console.log(`  Organization : ${org.name} (${org.slug})`);
  console.log(`  Admin login  : ${adminEmail}`);
  if (generatedPassword) console.log(`  Password     : ${adminPassword}   (generated — store it now)`);
  console.log(`  Role         : OWNER`);
  console.log(`  Projects     : ${projectInputs.map((project) => project.slug).join(", ")}`);
  console.log(`  Budgets      : $${dailyBudget}/day, $${monthlyBudget}/month (hard limits)`);
  if (issuedKeys.length > 0) {
    console.log("\n  Application API keys (shown once):");
    for (const entry of issuedKeys) console.log(`    ${entry.project.padEnd(14)} ${entry.key}`);
  } else {
    console.log("\n  Existing API keys retained; rotate them from the dashboard if needed.");
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
