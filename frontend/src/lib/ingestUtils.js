// ============================================================================
// File: src/lib/ingestUtils.js
// Version: 1.1-ingest-utils-shared-registry-detail | 2026-03-20
// Purpose:
//   Shared UI helpers for the ingest slice.
// Notes:
//   - Keeps ingest pages consistent.
//   - Centralizes posture, envelope parsing, trust labeling, request helpers,
//     formatting, and common extraction logic.
// ============================================================================

export function deriveIngestPosture(entitlements, membership) {
  const canUseIngest = Boolean(entitlements?.canUseIngest);
  const canMintCertificates = Boolean(entitlements?.canMintCertificates);
  const isTenantAdmin = String(membership?.role || "").trim() === "tenant_admin";

  return {
    canUseIngest,
    canMintCertificates,
    canAnchor: canUseIngest,
    canRegisterAndAnchor: canUseIngest && isTenantAdmin,
    isTenantAdmin,
  };
}

export function normalizeEnvelope(payload) {
  return payload?.result ?? payload ?? null;
}

export function normalizeAnchorRequestsEnvelope(payload) {
  const root = normalizeEnvelope(payload) ?? {};
  const rows = Array.isArray(root?.rows) ? root.rows : [];
  const limit = Number(root?.limit ?? rows.length ?? 0) || 0;
  const offset = Number(root?.offset ?? 0) || 0;

  return {
    rows,
    limit,
    offset,
  };
}

export function shortHash(value, left = 10, right = 8) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= left + right) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function shortText(value, max = 44) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(12, max - 12))}…${s.slice(-10)}`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatRelative(value) {
  if (!value) return "never";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";

  const diff = ms - Date.now();
  const abs = Math.abs(diff);

  const units = [
    { max: 60_000, div: 1_000, name: "second" },
    { max: 3_600_000, div: 60_000, name: "minute" },
    { max: 86_400_000, div: 3_600_000, name: "hour" },
    { max: 2_592_000_000, div: 86_400_000, name: "day" },
    { max: 31_536_000_000, div: 2_592_000_000, name: "month" },
    { max: Number.POSITIVE_INFINITY, div: 31_536_000_000, name: "year" },
  ];

  const picked = units.find((u) => abs < u.max) || units[units.length - 1];
  const valueInt = Math.max(1, Math.round(abs / picked.div));

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    diff < 0 ? -valueInt : valueInt,
    picked.name
  );
}

export function extractApiErrorMessage(err, fallback = "Request failed.") {
  return (
    err?.payload?.detail?.message ||
    err?.payload?.upstream_detail?.message ||
    err?.payload?.message ||
    err?.message ||
    fallback
  );
}

export function getRootHash(root) {
  return (
    root?.root_hash ||
    root?.hash ||
    root?.root?.root_hash ||
    root?.root?.hash ||
    ""
  );
}

export function getRootId(root) {
  return (
    root?.root_id ||
    root?.id ||
    root?.root?.root_id ||
    root?.root?.id ||
    ""
  );
}

export function getRootProofDate(root) {
  return (
    root?.proof_date ||
    root?.root?.proof_date ||
    root?.created_at ||
    root?.updated_at ||
    null
  );
}

export function getLeafCount(value) {
  const direct =
    value?.leaf_count ??
    value?.leafCount ??
    value?.tree?.leaf_count ??
    value?.tree?.leafCount ??
    null;

  if (Number.isFinite(Number(direct))) {
    return Number(direct);
  }

  if (Array.isArray(value?.leaves)) return value.leaves.length;
  if (Array.isArray(value?.tree?.leaves)) return value.tree.leaves.length;

  return null;
}

export function getProofLeafHash(value) {
  return (
    value?.leaf_hash ||
    value?.leaf?.leaf_hash ||
    value?.proof?.leaf_hash ||
    ""
  );
}

export function getProofRootHash(value) {
  return (
    value?.root_hash ||
    value?.root?.root_hash ||
    value?.proof?.root_hash ||
    ""
  );
}

export function getProofAuditPathLength(value) {
  const path =
    value?.audit_path ||
    value?.auditPath ||
    value?.proof?.audit_path ||
    value?.proof?.auditPath ||
    value?.proof?.path ||
    value?.path ||
    null;

  return Array.isArray(path) ? path.length : null;
}

export function getRootTrustState(root) {
  if (!root) return "missing";

  const hasRoot = Boolean(getRootHash(root) || getRootId(root));
  if (!hasRoot) return "missing";

  if (root?.mirror_verified || root?.confirmed_at || root?.root?.confirmed_at) {
    return "verified";
  }

  return "anchored";
}

export function trustVariant(trust) {
  switch (trust) {
    case "verified":
      return "success";
    case "anchored":
      return "outline";
    case "missing":
      return "warn";
    case "pending":
      return "warn";
    case "degraded":
      return "destructive";
    default:
      return "outline";
  }
}

export function trustLabel(trust) {
  switch (trust) {
    case "verified":
      return "Verified";
    case "anchored":
      return "Anchored";
    case "missing":
      return "Missing";
    case "pending":
      return "Pending";
    case "degraded":
      return "Attention";
    default:
      return "Unknown";
  }
}

export function getAnchorRequestId(row) {
  return row?.anchor_request_id || row?.id || "";
}

export function getAnchorStatus(row) {
  return String(row?.status || "").trim().toLowerCase() || "unknown";
}

export function getAnchorKind(row) {
  return String(row?.anchor_kind || "").trim().toLowerCase() || "unknown";
}

export function getAnchorLabel(row) {
  const kind = getAnchorKind(row);
  const payloadType = String(row?.payload_type || "").trim();

  if (kind === "root") return "Root anchor request";
  if (payloadType) return payloadType;
  if (kind && kind !== "unknown") return kind.replace(/_/g, " ");
  return "Anchor request";
}

export function getAnchorTrustState(row) {
  const status = getAnchorStatus(row);

  if (status === "confirmed") return "verified";
  if (
    status === "published" ||
    Boolean(row?.hcs_topic_id) ||
    Boolean(row?.hcs_transaction_id) ||
    Boolean(row?.hcs_message_id)
  ) {
    return "anchored";
  }
  if (status === "failed" || status === "cancelled") return "degraded";
  return "pending";
}

export function statusVariant(status) {
  switch (status) {
    case "confirmed":
      return "success";
    case "published":
    case "publishing":
      return "outline";
    case "pending":
      return "warn";
    case "failed":
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

export function statusLabel(status) {
  if (!status) return "Unknown";
  return String(status).replace(/_/g, " ");
}

export function kindVariant(kind) {
  switch (kind) {
    case "root":
      return "success";
    case "custom":
      return "outline";
    default:
      return "outline";
  }
}

export function kindLabel(kind) {
  if (!kind) return "Unknown";
  return String(kind).replace(/_/g, " ");
}

export function matchesRequestQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    getAnchorRequestId(row),
    getAnchorLabel(row),
    row?.proof_date,
    row?.domain,
    row?.anchor_kind,
    row?.payload_type,
    row?.payload_hash,
    row?.root_id,
    row?.root_hash,
    row?.leaf_id,
    row?.leaf_hash,
    row?.anchor_hash,
    row?.hcs_topic_id,
    row?.hcs_transaction_id,
    row?.hcs_message_id,
    row?.status,
    row?.reason,
    row?.last_error_code,
    row?.last_error,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

export function getRequestUpdatedAt(row) {
  return (
    row?.updated_at ||
    row?.confirmed_at ||
    row?.published_at ||
    row?.created_at ||
    null
  );
}

export function summarizeOperationalState(row) {
  const status = getAnchorStatus(row);
  const trust = getAnchorTrustState(row);

  if (status === "confirmed") {
    return "This request has completed publication and has confirmed trust-layer visibility.";
  }

  if (status === "published") {
    return "This request has been published and carries trust linkage, but final confirmation may still be catching up.";
  }

  if (status === "publishing") {
    return "This request is currently in the publication phase and may still be acquiring final trust-layer references.";
  }

  if (status === "failed") {
    return "This request encountered a failure and should be reviewed through lifecycle diagnostics and error details.";
  }

  if (status === "cancelled") {
    return "This request is no longer active and will not continue through the normal publication lifecycle.";
  }

  if (trust === "pending") {
    return "This request has been recorded but has not yet reached published trust posture.";
  }

  return "This request is visible and should be interpreted through its current lifecycle state, linkage, and diagnostics.";
}