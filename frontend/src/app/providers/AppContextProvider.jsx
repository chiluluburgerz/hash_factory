import React from "react";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

const AppContext = React.createContext(null);

function defaultContextValue() {
  return {
    isLoading: true,
    isAuthenticated: false,
    authFailed: false,
    error: null,
    user: null,
    org: null,
    membership: null,
    entitlements: {
      tier: null,
      raw: null,
      canUseIngest: false,
      canUseDatasets: false,
      canMintCertificates: false,
      canManageApiKeys: false,
      canManageOrg: false,
    },
    wallets: [],
    primaryWallet: null,
    userKeyPublic: null,
    apiKeys: {
      total: 0,
      active: 0,
      rows: [],
    },
    firstIngest: {
      completed: false,
      completedAt: null,
    },
    topicReadiness: null,
    setup: {
      loaded: false,
      loadError: null,
      isReady: true,
      blockingCount: 0,
      completedCount: 0,
      totalCount: 0,
      tasks: [],
    },
    resourceErrors: {
      user: null,
      org: null,
      entitlements: null,
      wallets: null,
      primaryWallet: null,
      userKeyPublic: null,
      apiKeys: null,
      topicReadiness: null,
    },
    refreshAppContext: async () => {},
    markFirstIngestComplete: () => {},
  };
}

function firstIngestStorageKey(userId, orgId) {
  return `hf:first-ingest:${String(userId || "anon")}:${String(orgId || "no-org")}`;
}

function readFirstIngestState(userId, orgId) {
  try {
    const raw = window.localStorage.getItem(firstIngestStorageKey(userId, orgId));
    if (!raw) return { completed: false, completedAt: null };
    const parsed = JSON.parse(raw);
    return {
      completed: Boolean(parsed?.completed),
      completedAt: parsed?.completedAt || null,
    };
  } catch {
    return { completed: false, completedAt: null };
  }
}

function writeFirstIngestState(userId, orgId, value) {
  try {
    window.localStorage.setItem(
      firstIngestStorageKey(userId, orgId),
      JSON.stringify({
        completed: Boolean(value?.completed),
        completedAt: value?.completedAt || null,
      })
    );
  } catch {
    // ignore
  }
}

function setupUnlockStorageKey(userId, orgId) {
  return `hf:setup-unlocked:${String(userId || "anon")}:${String(orgId || "no-org")}`;
}

function readSetupUnlockState(userId, orgId) {
  try {
    return window.localStorage.getItem(setupUnlockStorageKey(userId, orgId)) === "true";
  } catch {
    return false;
  }
}

function writeSetupUnlockState(userId, orgId, unlocked) {
  try {
    window.localStorage.setItem(
      setupUnlockStorageKey(userId, orgId),
      unlocked ? "true" : "false"
    );
  } catch {
    // ignore
  }
}

function normalizeUserEnvelope(payload) {
  const row = payload?.result ?? payload ?? null;
  if (!row) return null;

  return {
    id: row.id ?? row.user_id ?? null,
    orgId: row.org_id ?? null,
    email: row.email ?? "",
    displayName:
      row.display_name ??
      row.name ??
      row.full_name ??
      row.email ??
      "User",
    avatarUrl: row.avatar_url ?? "",
    role: row.role ?? row.org_role ?? "",
    walletAddress: row.wallet_address ?? null,
    kycStatus: row.kyc_status ?? null,
    raw: row,
  };
}

function normalizeTopicReadinessEnvelope(payload) {
  const row = payload?.result ?? payload ?? null;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;

  const requiredTopicNames = Array.isArray(row.required_topic_names)
    ? row.required_topic_names.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  const presentTopicNames = Array.isArray(row.present_topic_names)
    ? row.present_topic_names.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  const missingTopicNames = Array.isArray(row.missing_topic_names)
    ? row.missing_topic_names.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  return {
    orgId: row.org_id ?? null,
    ready: Boolean(row.ready),
    requiredTopicNames,
    presentTopicNames,
    missingTopicNames,
    meta: {
      requiredCount:
        Number(
          row?.meta?.required_count ??
          requiredTopicNames.length
        ) || 0,
      presentCount:
        Number(
          row?.meta?.present_count ??
          presentTopicNames.length
        ) || 0,
      missingCount:
        Number(
          row?.meta?.missing_count ??
          missingTopicNames.length
        ) || 0,
    },
    raw: row,
  };
}

function normalizeOrgEnvelope(payload) {
  const row = payload?.result ?? payload ?? null;
  if (!row) {
    return {
      org: null,
    };
  }

  return {
    org: {
      id: row.id ?? row.org_id ?? null,
      name: row.name ?? row.org_name ?? "Organization",
      slug: row.slug ?? "",
      email: row.email ?? "",
      billingTier: row.billing_tier ?? row.tier ?? null,
      kycStatus: row.kyc_status ?? null,
      walletAddress: row.wallet_address ?? null,
      status: row.status ?? null,
      raw: row,
    },
  };
}

function isWalletLike(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;

  const id = String(row.id ?? "").trim();
  const walletAddress = String(
    row.wallet_address ?? row.address ?? row.evm_address ?? ""
  ).trim();
  const userId = String(row.user_id ?? "").trim();
  const orgId = String(row.org_id ?? "").trim();

  return Boolean(id || walletAddress || userId || orgId);
}

function normalizeWalletListEnvelope(payload) {
  if (!payload) return [];

  const root = payload?.result ?? payload ?? null;

  const rows =
    Array.isArray(root)
      ? root
      : Array.isArray(root?.items)
        ? root.items
        : Array.isArray(root?.rows)
          ? root.rows
          : Array.isArray(payload?.result?.items)
            ? payload.result.items
            : Array.isArray(payload?.result?.rows)
              ? payload.result.rows
              : Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload?.rows)
                  ? payload.rows
                  : [];

  return rows.filter(isWalletLike);
}

function normalizeWalletEnvelope(payload) {
  if (!payload) return null;
  const root = payload?.result ?? payload ?? null;
  if (!isWalletLike(root)) return null;
  return root;
}

function derivePrimaryWallet(wallets, primaryWallet) {
  const safeWallets = Array.isArray(wallets) ? wallets.filter(isWalletLike) : [];
  const safePrimary = isWalletLike(primaryWallet) ? primaryWallet : null;

  if (safePrimary) {
    const matching = safeWallets.find((w) => {
      if (safePrimary.id && w?.id) return String(w.id) === String(safePrimary.id);
      const a = String(
        safePrimary.wallet_address ?? safePrimary.address ?? safePrimary.evm_address ?? ""
      ).trim().toLowerCase();
      const b = String(
        w?.wallet_address ?? w?.address ?? w?.evm_address ?? ""
      ).trim().toLowerCase();
      return a && b && a === b;
    });
    return matching || safePrimary;
  }

  if (safeWallets.length === 0) return null;
  return safeWallets.find((w) => w?.is_primary) || safeWallets[0] || null;
}

function isApiKeyActive(row) {
  if (!row || typeof row !== "object") return false;

  const status = String(row.status ?? "").trim().toLowerCase();
  if (status) {
    return status === "active";
  }

  if (row.deleted_at != null) return false;
  if (row.revoked_at != null) return false;
  if (row.disabled_at != null) return false;

  return true;
}

function normalizeApiKeysEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  const rows =
    Array.isArray(root)
      ? root
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.items)
          ? root.items
          : Array.isArray(payload?.rows)
            ? payload.rows
            : Array.isArray(payload?.items)
              ? payload.items
              : [];

  const total =
    Number(
      root?.total ??
      payload?.total ??
      rows.length
    ) || 0;

  const active = rows.filter(isApiKeyActive).length;

  return {
    total,
    active,
    rows,
  };
}

function normalizeUserKeyPublicEnvelope(payload) {
  const row = payload?.result ?? payload ?? null;
  if (!row || typeof row !== "object") return null;

  const keyVersion =
    row.key_version ??
    row.version ??
    row.current_key_version ??
    null;

  const publicKey =
    row.public_key_pem ??
    row.public_key ??
    row.publicKey ??
    row.key ??
    null;

  if (keyVersion == null && !publicKey) return null;

  return {
    keyVersion,
    publicKey,
    raw: row,
  };
}

function hasReasonableProfile(user) {
  const name = String(
    user?.displayName ??
    user?.raw?.name ??
    ""
  ).trim();

  const slug = String(user?.raw?.slug ?? "").trim();

  return name.length >= 3 && slug.length >= 1;
}

function hasReasonableOrgProfile(org) {
  const name = String(org?.name ?? org?.raw?.name ?? "").trim();
  const slug = String(org?.slug ?? org?.raw?.slug ?? "").trim();
  const email = String(org?.email ?? org?.raw?.email ?? "").trim();

  const hasValidName = name.length >= 3;
  const hasValidSlug = slug.length >= 1;
  const hasValidEmail = !email || /^[^@]+@[^@]+\.[^@]+$/.test(email);

  return hasValidName && hasValidSlug && hasValidEmail;
}

function hasCompletedFirstIngest(firstIngest) {
  return Boolean(firstIngest?.completed);
}

function readPath(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function asBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "enabled") return true;
    if (s === "false" || s === "0" || s === "no" || s === "disabled") return false;
  }
  return fallback;
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function normalizeEntitlementsEnvelope(payload, membershipRole = "", orgBillingTier = null) {
  const row = payload?.result ?? payload ?? null;
  const raw = row ?? null;

  const tier =
    firstDefined(
      readPath(row, "billing.tier"),
      readPath(row, "billing_tier"),
      readPath(row, "tier"),
      readPath(row, "plan"),
      orgBillingTier
    ) ?? null;

  const canUseIngest = asBool(
    firstDefined(
      readPath(row, "features.dataset_ingest"),
      readPath(row, "features.ingest.enabled"),
      readPath(row, "ingest.enabled"),
      readPath(row, "caps.ingest"),
      readPath(row, "permissions.ingest"),
      readPath(row, "allow.ingest")
    ),
    true
  );

  const canUseDatasets = asBool(
    firstDefined(
      readPath(row, "features.dataset_registry"),
      readPath(row, "features.datasets.enabled"),
      readPath(row, "datasets.enabled"),
      readPath(row, "caps.datasets"),
      readPath(row, "permissions.datasets"),
      readPath(row, "allow.datasets")
    ),
    true
  );

  const canMintCertificates = asBool(
    firstDefined(
      readPath(row, "features.nft_certificates.enabled"),
      readPath(row, "features.nft_certificates.dataset"),
      readPath(row, "features.certificates.enabled"),
      readPath(row, "features.mint_certificates.enabled"),
      readPath(row, "caps.certificates"),
      readPath(row, "permissions.certificates"),
      readPath(row, "allow.certificates")
    ),
    false
  );

  const isTenantAdmin = membershipRole === "tenant_admin";

  return {
    tier,
    raw,
    canUseIngest,
    canUseDatasets,
    canMintCertificates,
    canManageApiKeys: isTenantAdmin,
    canManageOrg: isTenantAdmin,
  };
}

function deriveSetupState({
  user,
  org,
  membership,
  entitlements,
  primaryWallet,
  userKeyPublic,
  firstIngest,
  topicReadiness,
  setupLoadError = null,
  hasSetupUnlock = false,
}) {
  const isTenantAdmin = String(membership?.role ?? "") === "tenant_admin";
  const hasProfile = hasReasonableProfile(user);
  const hasOrgProfile = hasReasonableOrgProfile(org);
  const hasWallet = Boolean(primaryWallet);
  const hasUserKey = Boolean(userKeyPublic?.keyVersion || userKeyPublic?.publicKey);
  const hasFirstIngest = hasCompletedFirstIngest(firstIngest);

  const walletRequired = Boolean(entitlements?.canMintCertificates);
  const userKeyRequired =
    Boolean(entitlements?.canUseIngest || entitlements?.canUseDatasets);
  const topicsRequired = Boolean(userKeyRequired);
  const topicsReady = Boolean(topicReadiness?.ready);
  const canManageTopics = Boolean(isTenantAdmin);
  const firstIngestAvailable =
    Boolean(user?.id && org?.id) &&
    Boolean(entitlements?.canUseIngest) &&
    (!walletRequired || hasWallet) &&
    (!userKeyRequired || hasUserKey);

  const tasks = [
    {
      id: "profile",
      title: "Complete profile",
      description: "Review your personal identity fields used across the workspace.",
      status: hasProfile ? "complete" : "action_required",
      required: false,
      entitled: true,
      actionable: true,
      href: "/app/profile",
    },
    {
      id: "org_profile",
      title: "Review organization",
      description: "Review and complete the tenant identity fields used across the workspace.",
      status: hasOrgProfile ? "complete" : "action_required",
      required: true,
      entitled: true,
      actionable: true,
      href: "/app/org",
    },
    {
      id: "user_key",
      title: "Create encryption key",
      description: isTenantAdmin
        ? "Generate the user encryption key required for protected trust workflows."
        : "Your org admin may need to generate your encryption key before protected workflows are available.",
      status: hasUserKey ? "complete" : userKeyRequired ? "action_required" : "unavailable",
      required: userKeyRequired,
      entitled: userKeyRequired,
      actionable: isTenantAdmin,
      href: "/app/setup",
    },
    {
      id: "topics",
      title: "Bootstrap tenant topics",
      description: isTenantAdmin
        ? topicsReady
          ? "Required tenant Hedera topics are present."
          : "Initialize the Hedera topics required for tenant-scoped trust workflows."
        : "Tenant topic setup is managed by your organization admin.",
      status: !topicsRequired
        ? "unavailable"
        : topicsReady
          ? "complete"
          : canManageTopics
            ? "action_required"
            : "unknown",
      required: topicsRequired,
      entitled: topicsRequired,
      actionable: canManageTopics,
      href: "/app/setup",
      readiness: topicReadiness
        ? {
            ready: topicsReady,
            requiredTopicNames: topicReadiness.requiredTopicNames,
            presentTopicNames: topicReadiness.presentTopicNames,
            missingTopicNames: topicReadiness.missingTopicNames,
            meta: topicReadiness.meta,
          }
        : null,
    },
    {
      id: "wallet",
      title: "Provision primary wallet",
      description: "Create or select the wallet used for ownership-linked workflows.",
      status: hasWallet ? "complete" : walletRequired ? "action_required" : "unavailable",
      required: walletRequired,
      entitled: walletRequired,
      actionable: true,
      href: "/app/wallets",
    },
    {
      id: "first_ingest",
      title: "Run your first ingest",
      description: hasFirstIngest
        ? "Your first guided ingest has been completed."
        : "Walk through a simple text-based ingest, then verify it and inspect the resulting trust outputs.",
      status: !firstIngestAvailable
        ? "unavailable"
        : hasFirstIngest
          ? "complete"
          : "action_required",
      required: false,
      entitled: Boolean(entitlements?.canUseIngest),
      actionable: firstIngestAvailable,
      skippable: true,
      href: "/app/ingest/anchor?onboarding=first"
    },
  ];

  const requiredCount = tasks.filter(
    (task) => task.required && task.status !== "complete"
  ).length;

  const completedCount = tasks.filter((task) => task.status === "complete").length;

  const currentlyReady = Boolean(user?.id && org?.id) && requiredCount === 0;
  const shouldGate = !hasSetupUnlock && !currentlyReady;

  return {
    loaded: true,
    loadError: setupLoadError,
    isReady: currentlyReady,
    isUnlocked: Boolean(hasSetupUnlock),
    shouldGate,
    blockingCount: requiredCount,
    requiredCount,
    completedCount,
    totalCount: tasks.length,
    tasks,
  };
}

function toErrorInfo(err) {
  if (!err) return null;
  return {
    name: err.name || "Error",
    message: err.message || String(err),
    status: err.status ?? err.statusCode ?? null,
    url: err.url ?? null,
    payload: err.payload ?? null,
    responseText: err.responseText ?? "",
    contentType: err.contentType ?? "",
    contentLength: err.contentLength ?? null,
    method: err.method ?? null,
  };
}

function isNotFoundError(err) {
  const status = Number(
    err?.status ??
    err?.statusCode ??
    err?.payload?.statusCode ??
    0
  );

  const code = String(err?.code ?? err?.payload?.code ?? "").trim().toUpperCase();
  const message = String(err?.message ?? err?.payload?.message ?? "").trim().toLowerCase();

  return (
    status === 404 ||
    code === "NOT_FOUND" ||
    message === "not_found"
  );
}

function isExpectedSetupAbsence(label, err) {
  if (!isNotFoundError(err)) return false;
  return label === "primaryWallet" || label === "userKeyPublic";
}

async function settleResource(label, fn, options = {}) {
  const allow404 = options.allow404 === true;

  try {
    const payload = await fn();
    return { ok: true, payload, error: null, label };
  } catch (err) {
    const errorInfo = toErrorInfo(err);

    if (allow404 && isExpectedSetupAbsence(label, errorInfo)) {
      return { ok: true, payload: null, error: null, label };
    }

    return { ok: false, payload: null, error: errorInfo, label };
  }
}

export function AppContextProvider({ children }) {
  const [state, setState] = React.useState(defaultContextValue);

  const load = React.useCallback(async (options = {}) => {
    const silent = options?.silent === true;

    if (!silent) {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        error: null,
      }));
    }

    const userResult = await settleResource("user", () => fetchJsonOrThrow("/v1/users/me"));
    const orgResult = await settleResource("org", () => fetchJsonOrThrow("/v1/orgs/me"));

    if (!userResult.ok || !orgResult.ok) {
      const fatalError = userResult.error || orgResult.error || {
        name: "Error",
        message: "Failed to load HF bootstrap identity context.",
        status: null,
        url: null,
        payload: null,
        responseText: "",
        contentType: "",
      };

      const fatalStatus = Number(
        userResult.error?.status ??
        orgResult.error?.status ??
        0
      );

      const authFailed = fatalStatus === 401 || fatalStatus === 403;

      setState({
        ...defaultContextValue(),
        isLoading: false,
        isAuthenticated: false,
        authFailed,
        error: fatalError,
        resourceErrors: {
          user: userResult.error,
          org: orgResult.error,
          entitlements: null,
          wallets: null,
          primaryWallet: null,
          userKeyPublic: null,
          apiKeys: null,
        },
      });
      return;
    }

    const user = normalizeUserEnvelope(userResult.payload);
    const { org } = normalizeOrgEnvelope(orgResult.payload);

    const membership = {
      role: user?.role ?? "",
    };

    const [
      entitlementsResult,
      walletsResult,
      primaryWalletResult,
      userKeyPublicResult,
      apiKeysResult,
      topicReadinessResult,
    ] = await Promise.all([
      settleResource("entitlements", () => fetchJsonOrThrow("/v1/org-entitlements/me")),
      settleResource("wallets", () => fetchJsonOrThrow("/v1/wallets/me")),
      settleResource(
        "primaryWallet",
        () => fetchJsonOrThrow("/v1/wallets/me/primary"),
        { allow404: true }
      ),
      settleResource(
        "userKeyPublic",
        () => fetchJsonOrThrow("/user-keys/me/public"),
        { allow404: true }
      ),
      settleResource("apiKeys", () => fetchJsonOrThrow("/api-keys/my?limit=50&offset=0")),
      org?.id
        ? settleResource(
            "topicReadiness",
            () => fetchJsonOrThrow(`/v1/orgs/${encodeURIComponent(org.id)}/hedera/topics/readiness`)
          )
        : Promise.resolve({ ok: true, payload: null, error: null, label: "topicReadiness" }),
    ]);

    const entitlements = normalizeEntitlementsEnvelope(
      entitlementsResult.payload,
      membership?.role ?? "",
      org?.billingTier ?? null
    );

    const wallets = normalizeWalletListEnvelope(walletsResult.payload);
    const primaryWalletFromEndpoint = normalizeWalletEnvelope(primaryWalletResult.payload);
    const primaryWallet = derivePrimaryWallet(wallets, primaryWalletFromEndpoint);
    const userKeyPublic = normalizeUserKeyPublicEnvelope(userKeyPublicResult.payload);
    const apiKeys = normalizeApiKeysEnvelope(apiKeysResult.payload);
    const topicReadiness = normalizeTopicReadinessEnvelope(topicReadinessResult.payload);
    const firstIngest = readFirstIngestState(user?.id, org?.id);
    const priorSetupUnlock = readSetupUnlockState(user?.id, org?.id);

    const resourceErrors = {
      user: userResult.error,
      org: orgResult.error,
      entitlements: entitlementsResult.error,
      wallets: walletsResult.error,
      primaryWallet: primaryWalletResult.error,
      userKeyPublic: userKeyPublicResult.error,
      apiKeys: apiKeysResult.error,
      topicReadiness: topicReadinessResult.error,
    };

    const setupLoadError =
      resourceErrors.entitlements ||
      resourceErrors.wallets ||
      resourceErrors.apiKeys ||
      resourceErrors.topicReadiness ||
      null;

    const provisionalSetup = deriveSetupState({
      user,
      org,
      membership,
      entitlements,
      primaryWallet,
      userKeyPublic,
      firstIngest,
      topicReadiness,
      setupLoadError: setupLoadError?.message || null,
      hasSetupUnlock: priorSetupUnlock,
    });

    const nextSetupUnlock = priorSetupUnlock || provisionalSetup.isReady;

    if (nextSetupUnlock !== priorSetupUnlock) {
      writeSetupUnlockState(user?.id, org?.id, nextSetupUnlock);
    }

    const setup = deriveSetupState({
      user,
      org,
      membership,
      entitlements,
      primaryWallet,
      userKeyPublic,
      firstIngest,
      topicReadiness,
      setupLoadError: setupLoadError?.message || null,
      hasSetupUnlock: nextSetupUnlock,
    });

    const topLevelError =
      resourceErrors.entitlements ||
      resourceErrors.wallets ||
      resourceErrors.apiKeys ||
      resourceErrors.topicReadiness ||
      null;

    setState({
      isLoading: false,
      isAuthenticated: !!user,
      authFailed: false,
      error: topLevelError,
      user,
      org,
      membership,
      entitlements,
      wallets,
      primaryWallet,
      userKeyPublic,
      apiKeys,
      firstIngest,
      topicReadiness,
      setup,
      resourceErrors,
      refreshAppContext: async () => {},
      markFirstIngestComplete: () => {},
    });
  }, []);

  const markFirstIngestComplete = React.useCallback(() => {
    setState((prev) => {
      const nextFirstIngest = {
        completed: true,
        completedAt: new Date().toISOString(),
      };

      writeFirstIngestState(prev.user?.id, prev.org?.id, nextFirstIngest);

      const priorUnlock =
        Boolean(prev.setup?.isUnlocked) ||
        readSetupUnlockState(prev.user?.id, prev.org?.id);

      const provisionalSetup = deriveSetupState({
        user: prev.user,
        org: prev.org,
        membership: prev.membership,
        entitlements: prev.entitlements,
        primaryWallet: prev.primaryWallet,
        userKeyPublic: prev.userKeyPublic,
        firstIngest: nextFirstIngest,
        topicReadiness: prev.topicReadiness,
        setupLoadError: prev.setup?.loadError ?? null,
        hasSetupUnlock: priorUnlock,
      });

      const nextSetupUnlock = priorUnlock || provisionalSetup.isReady;

      if (nextSetupUnlock !== priorUnlock) {
        writeSetupUnlockState(prev.user?.id, prev.org?.id, nextSetupUnlock);
      }

      return {
        ...prev,
        firstIngest: nextFirstIngest,
        setup: deriveSetupState({
          user: prev.user,
          org: prev.org,
          membership: prev.membership,
          entitlements: prev.entitlements,
          primaryWallet: prev.primaryWallet,
          userKeyPublic: prev.userKeyPublic,
          firstIngest: nextFirstIngest,
          topicReadiness: prev.topicReadiness,
          setupLoadError: prev.setup?.loadError ?? null,
          hasSetupUnlock: nextSetupUnlock,
        }),
      };
    });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const value = React.useMemo(
    () => ({
      ...state,
      refreshAppContext: load,
      markFirstIngestComplete,
    }),
    [state, load, markFirstIngestComplete]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export { AppContext };