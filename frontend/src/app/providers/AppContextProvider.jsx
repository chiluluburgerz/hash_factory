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
    apiKeys: {
      total: 0,
      active: 0,
      rows: [],
    },
    resourceErrors: {
      user: null,
      org: null,
      entitlements: null,
      wallets: null,
      primaryWallet: null,
      apiKeys: null,
    },
    refreshAppContext: async () => {},
  };
}

function derivePrimaryWallet(wallets, primaryWallet) {
  if (primaryWallet) return primaryWallet;
  if (!Array.isArray(wallets) || wallets.length === 0) return null;
  return wallets.find((w) => w?.is_primary) || wallets[0] || null;
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

function normalizeWalletListEnvelope(payload) {
  if (!payload) return [];

  const root = payload?.result ?? payload ?? null;

  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.items)) return root.items;
  if (Array.isArray(root?.rows)) return root.rows;

  if (Array.isArray(payload?.result?.items)) return payload.result.items;
  if (Array.isArray(payload?.result?.rows)) return payload.result.rows;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;

  return [];
}

function normalizeWalletEnvelope(payload) {
  if (!payload) return null;
  const root = payload?.result ?? payload ?? null;
  if (!root || Array.isArray(root)) return null;
  return root;
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

function toErrorInfo(err) {
  if (!err) return null;
  return {
    name: err.name || "Error",
    message: err.message || String(err),
    status: err.status ?? null,
    url: err.url ?? null,
    payload: err.payload ?? null,
    responseText: err.responseText ?? "",
    contentType: err.contentType ?? "",
    contentLength: err.contentLength ?? null,
    method: err.method ?? null,
  };
}

async function settleResource(label, fn) {
  try {
    const payload = await fn();
    return { ok: true, payload, error: null, label };
  } catch (err) {
    return { ok: false, payload: null, error: toErrorInfo(err), label };
  }
}

export function AppContextProvider({ children }) {
  const [state, setState] = React.useState(defaultContextValue);

  const load = React.useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

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
      apiKeysResult,
    ] = await Promise.all([
      settleResource("entitlements", () => fetchJsonOrThrow("/v1/org-entitlements/me")),
      settleResource("wallets", () => fetchJsonOrThrow("/v1/wallets/me")),
      settleResource("primaryWallet", () => fetchJsonOrThrow("/v1/wallets/me/primary")),
      settleResource("apiKeys", () => fetchJsonOrThrow("/api-keys/my?limit=50&offset=0")),
    ]);

    const entitlements = normalizeEntitlementsEnvelope(
      entitlementsResult.payload,
      membership?.role ?? "",
      org?.billingTier ?? null
    );

    const walletsFromList = normalizeWalletListEnvelope(walletsResult.payload);
    const primaryWalletFromEndpoint = normalizeWalletEnvelope(primaryWalletResult.payload);

    const wallets =
      walletsFromList.length > 0
        ? walletsFromList
        : primaryWalletFromEndpoint
          ? [primaryWalletFromEndpoint]
          : [];

    const primaryWallet = derivePrimaryWallet(wallets, primaryWalletFromEndpoint);
    const apiKeys = normalizeApiKeysEnvelope(apiKeysResult.payload);

    const resourceErrors = {
      user: userResult.error,
      org: orgResult.error,
      entitlements: entitlementsResult.error,
      wallets: walletsResult.error,
      primaryWallet: primaryWalletResult.error,
      apiKeys: apiKeysResult.error,
    };

    const topLevelError =
      resourceErrors.apiKeys ||
      resourceErrors.entitlements ||
      resourceErrors.wallets ||
      resourceErrors.primaryWallet ||
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
      apiKeys,
      resourceErrors,
      refreshAppContext: async () => {},
    });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const value = React.useMemo(
    () => ({
      ...state,
      refreshAppContext: load,
    }),
    [state, load]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export { AppContext };