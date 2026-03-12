// ============================================================================
// File: src/routes/index.ts
// Version: 1.1-routes-index | 2026-03-06
// Purpose:
//   Single route registration entrypoint.
// ============================================================================

import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { hashRoutes } from "./hash.js";
import apiKeysRoutes from "./apiKeys.js";
import datasetsAnchorRoutes from "./datasetsAnchor.js";
import datasetsReadRoutes from "./datasetsRead.js";
import datasetsWriteRoutes from "./datasetsWrite.js";
import ingestRoutes from "./ingest.js";
import merkleAnchorWriteRoutes from "./merkleAnchorWrite.js";
import merkleReadRoutes from "./merkleRead.js";
import merkleWriteRoutes from "./merkleWrite.js";
import onboardingRoutes from "./onboarding.js";
import userKeysRoutes from "./userKeys.js";
import topicsRoutes from "./topics.js";
import { smokeCoreRoutes } from "./smokeCore.js";
import { CoreClient } from "../core/coreClient.js";
import { makeCoreMerkle } from "../core/merkleClient.js";
import { makeCoreMerkleAnchor } from "../core/merkleAnchorClient.js";
import { OnboardingService } from "../services/onboardingService.js";
import { makeCoreDatasets } from "../core/datasetsClient.js";
import makeCoreUserKeys from "../core/userKeysClient.js";
import { makeCoreTopics } from "../core/topicsClient.js";
import { pool } from "../db.js";

export async function registerRoutes(app: FastifyInstance) {
  await healthRoutes(app);
  await hashRoutes(app);

  // ---------------------------------------------------------------------------
  // Core gateway clients/services
  // ---------------------------------------------------------------------------
  const coreBaseUrl = String(process.env.CORE_BACKEND_URL || "").trim();
  if (!coreBaseUrl) throw new Error("CORE_BACKEND_URL is required to register core gateway routes");

  const coreServiceApiKey = String(process.env.CORE_SERVICE_API_KEY || "").trim();
  if (!coreServiceApiKey) throw new Error("CORE_SERVICE_API_KEY is required to register core gateway routes");

  const core = new CoreClient({
    baseUrl: coreBaseUrl,
    apiKey: coreServiceApiKey,
    timeoutMs: Number(process.env.CORE_TIMEOUT_MS || 10_000),
    maxResponseBytes: Number(process.env.CORE_MAX_RESPONSE_BYTES || 256_000),
  });

  // Datasets can return larger payloads (manifests, version rows, etc.).
  // Keep this client isolated so you can tune timeouts/limits without impacting other gateway routes.
  const coreDatasets = new CoreClient({
    baseUrl: coreBaseUrl,
    apiKey: coreServiceApiKey,
    timeoutMs: Number(process.env.CORE_DATASETS_TIMEOUT_MS || 20_000),
    maxResponseBytes: Number(process.env.CORE_DATASETS_MAX_RESPONSE_BYTES || 2_000_000),
    maxRetries: 0,
  });

  const coreMerkle = new CoreClient({
    baseUrl: coreBaseUrl,
    apiKey: coreServiceApiKey,
    timeoutMs: Number(process.env.CORE_MERKLE_TIMEOUT_MS || 20_000),
    maxResponseBytes: Number(process.env.CORE_MAX_RESPONSE_BYTES || 256_000),
    maxRetries: 0,
  });

  const coreTopics = new CoreClient({
    baseUrl: coreBaseUrl,
    apiKey: coreServiceApiKey,
    timeoutMs: Number(process.env.CORE_TOPICS_TIMEOUT_MS || 90_000),
    maxResponseBytes: Number(process.env.CORE_MAX_RESPONSE_BYTES || 256_000),
    maxRetries: 0,
  });

  const datasets = makeCoreDatasets(coreDatasets);
  const merkle = makeCoreMerkle(coreMerkle);
  const merkleAnchor = makeCoreMerkleAnchor(coreMerkle);
  const userKeys = makeCoreUserKeys(core);
  const topics = makeCoreTopics(coreTopics);

  const onboardingService = new OnboardingService({
    pool,
    core,
  } as any);

  // ---------------------------------------------------------------------------
  // Route plugins
  // ---------------------------------------------------------------------------
  await app.register(smokeCoreRoutes, { core });
  await app.register(apiKeysRoutes, { core });
  await app.register(datasetsAnchorRoutes, { datasets });
  await app.register(datasetsReadRoutes, { datasets });
  await app.register(datasetsWriteRoutes, { datasets });
  await app.register(ingestRoutes, { merkleAnchor });
  await app.register(merkleAnchorWriteRoutes, { merkleAnchor });
  await app.register(merkleReadRoutes, { merkle });
  await app.register(merkleWriteRoutes, { merkle });
  await app.register(onboardingRoutes, { onboardingService });
  await app.register(userKeysRoutes, { userKeys });
  await app.register(topicsRoutes, { topics });
}