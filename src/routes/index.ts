// ============================================================================
// File: src/routes/index.ts
// Version: 1.0-routes-index | 2026-02-17
// Purpose:
//   Single route registration entrypoint.
// ============================================================================

import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { hashRoutes } from "./hash.js";
import apiKeysRoutes from "./apiKeys.js";
import onboardingRoutes from "./onboarding.js";
import { CoreClient } from "../core/coreClient.js";
import { OnboardingService } from "../services/onboardingService.js";
import { pool } from "../db.js";

export async function registerRoutes(app: FastifyInstance) {
  await healthRoutes(app);
  await hashRoutes(app);

  // ---------------------------------------------------------------------------
  // Core gateway clients/services
  // ---------------------------------------------------------------------------
  const coreBaseUrl = String(process.env.CORE_BASE_URL || "").trim();
  if (!coreBaseUrl) throw new Error("CORE_BASE_URL is required to register core gateway routes");

  const coreServiceApiKey = String(process.env.CORE_SERVICE_API_KEY || "").trim();
  if (!coreServiceApiKey) throw new Error("CORE_SERVICE_API_KEY is required to register core gateway routes");

  const core = new CoreClient({
    baseUrl: coreBaseUrl,
    apiKey: coreServiceApiKey,
    timeoutMs: Number(process.env.CORE_TIMEOUT_MS || 10_000),
    maxResponseBytes: Number(process.env.CORE_MAX_RESPONSE_BYTES || 256_000),
  });

  const onboardingService = new OnboardingService({
    pool,
    core,
  } as any);

  // ---------------------------------------------------------------------------
  // Route plugins
  // ---------------------------------------------------------------------------
  await app.register(apiKeysRoutes, { core });
  await app.register(onboardingRoutes, { onboardingService });
}