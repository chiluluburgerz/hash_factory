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
import hederaRoutes from "./hedera.js";
import ingestRoutes from "./ingest.js";
import merkleAnchorReadRoutes from "./merkleAnchorRead.js";
import merkleAnchorWriteRoutes from "./merkleAnchorWrite.js";
import merkleReadRoutes from "./merkleRead.js";
import merkleWriteRoutes from "./merkleWrite.js";
import { nftCertificateRoutes } from "./nftCertificates.js";
import onboardingRoutes from "./onboarding.js";
import orgRoutes from "./orgs.js";
import orgEntitlementsRoutes from "./orgEntitlements.js";
import userKeysRoutes from "./userKeys.js";
import userRoutes from "./users.js";
import tokenRoutes from "./tokens.js";
import topicsRoutes from "./topics.js";
import walletRoutes from "./wallets.js";
import { smokeCoreRoutes } from "./smokeCore.js";
import { CoreClient } from "../core/coreClient.js";
import { makeCoreHedera } from "../core/hederaClient.js";
import { HederaService } from "../services/hederaService.js";
import { makeCoreMerkle } from "../core/merkleClient.js";
import { makeCoreMerkleAnchor } from "../core/merkleAnchorClient.js";
import { OnboardingService } from "../services/onboardingService.js";
import { makeCoreDatasets } from "../core/datasetsClient.js";
import { makeCoreNftCertificates } from "../core/nftCertificateClient.js";
import { NftCertificateService } from "../services/nftCertificateService.js";
import makeCoreUserKeys from "../core/userKeysClient.js";
import { makeCoreTopics } from "../core/topicsClient.js";
import { makeCoreWallets } from "../core/walletsClient.js";
import { OrgService } from "../services/orgService.js";
import { OrgEntitlementsService } from "../services/orgEntitlementsService.js";
import { makeCoreTokens } from "../core/tokensClient.js";
import { UserService } from "../services/userService.js";
import TokenService from "../services/tokenService.js";
import { WalletService } from "../services/walletService.js";
import { HfEntitlements } from "../lib/entitlements/hfOrgEntitlements.js";

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

  const hfEntitlements = new HfEntitlements({ core });

    const hederaClient = makeCoreHedera(core);

    const hederaService = new HederaService({
      hedera: hederaClient,
      entitlements: hfEntitlements,
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

  const certificates = makeCoreNftCertificates(core);
  const datasets = makeCoreDatasets(coreDatasets);
  const merkle = makeCoreMerkle(coreMerkle);
  const merkleAnchor = makeCoreMerkleAnchor(coreMerkle);
  const userKeys = makeCoreUserKeys(core);
  const topics = makeCoreTopics(coreTopics);
  const tokens = makeCoreTokens(core);
  const wallets = makeCoreWallets(core);

  const orgEntitlementsService = new OrgEntitlementsService({ core });
  const onboardingService = new OnboardingService({ core });

  const nftCertificateService = new NftCertificateService({
    certificates,
    entitlements: hfEntitlements,
  });

  const userService = new UserService({
    core,
    maxMetadataBytes: Number(process.env.HF_USERS_MAX_METADATA_BYTES || 16 * 1024),
  });

  const orgService = new OrgService({
    core,
    maxMetadataBytes: Number(process.env.HF_ORGS_MAX_METADATA_BYTES || 16 * 1024),
  });

  const tokenService = new TokenService({
    tokens,
    entitlements: hfEntitlements,
  });

  const walletService = new WalletService({
    wallets,
    entitlements: hfEntitlements,
  });

  // ---------------------------------------------------------------------------
  // Route plugins
  // ---------------------------------------------------------------------------
  await app.register(smokeCoreRoutes, { core });
  await app.register(hederaRoutes, { hederaService });
  await app.register(nftCertificateRoutes, { nftCertificateService });
  await app.register(orgEntitlementsRoutes, { orgEntitlementsService });
  await app.register(apiKeysRoutes, { core });
  await app.register(datasetsAnchorRoutes, { datasets });
  await app.register(datasetsReadRoutes, { datasets });
  await app.register(datasetsWriteRoutes, { datasets });
  await app.register(ingestRoutes, { merkleAnchor, merkle });
  await app.register(merkleAnchorReadRoutes, { merkleAnchor });
  await app.register(merkleAnchorWriteRoutes, { merkleAnchor });
  await app.register(merkleReadRoutes, { merkle });
  await app.register(merkleWriteRoutes, { merkle });
  await app.register(onboardingRoutes, { onboardingService });
  await app.register(orgRoutes, { orgService });
  await app.register(userKeysRoutes, { userKeys });
  await app.register(userRoutes, { userService });
  await app.register(tokenRoutes, { tokenService });
  await app.register(topicsRoutes, { topics, hederaService });
  await app.register(walletRoutes, { walletService });
}