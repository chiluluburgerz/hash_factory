import React from "react";
import { Badge } from "@/components/base/badge";
import MirrorStatusPill from "@/components/hcs/mirror-status-pill.jsx";

export const CERTIFICATE_TOKEN_CONFIG = Object.freeze({
  dataset_certificate: {
    tokenId: "0.0.8206550",
    symbol: "VADSCERT",
    displayName: "Vera Anchor Dataset Certificate",
    shortName: "Dataset Certificates",
    description:
      "Certificates issued from dataset-native Vera Anchor workflows.",
  },
  merkle_anchor_certificate: {
    tokenId: "0.0.8220630",
    symbol: "VAMACERT",
    displayName: "Vera Anchor Merkle Anchor Certificate",
    shortName: "Merkle Anchor Certificates",
    description:
      "Certificates issued from merkle-anchor proof and claim workflows.",
  },
});

export function isPlainObject(v) {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
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

export function formatDateOnly(value) {
  if (!value) return "—";
  const ms = Date.parse(String(value).length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(ms)) return String(value || "—");
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(ms));
}

export function formatRelative(value) {
  if (!value) return "never";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";

  const diff = ms - Date.now();
  const abs = Math.abs(diff);

  const units = [
    { max: 60_000, div: 1000, name: "second" },
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

export function shortId(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

export function shortHash(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 24) return s;
  return `${s.slice(0, 12)}…${s.slice(-10)}`;
}

export function shortTokenId(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  return s;
}

export function certificateKindLabel(kind) {
  switch (String(kind || "").trim()) {
    case "dataset_certificate":
      return "Dataset";
    case "merkle_anchor_certificate":
      return "Merkle Anchor";
    case "ingest_certificate":
      return "Ingest";
    default:
      return kind || "Unknown";
  }
}

export function certificateKindVariant(kind) {
  switch (String(kind || "").trim()) {
    case "dataset_certificate":
      return "info";
    case "merkle_anchor_certificate":
      return "outline";
    case "ingest_certificate":
      return "success";
    default:
      return "outline";
  }
}

export function getCertificateStatus(row) {
  const explicit = String(row?.status ?? "").trim().toLowerCase();
  if (explicit) return explicit;
  if (row?.deleted_at) return "deleted";
  if (row?.minted_at) return "minted";
  return "unknown";
}

export function certificateStatusVariant(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "minted":
      return "success";
    case "pending_mint":
    case "pending_delivery":
      return "warn";
    case "mint_failed":
    case "failed":
      return "destructive";
    case "deleted":
      return "outline";
    default:
      return "outline";
  }
}

export function certificateStatusLabel(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "unknown";
  return s.replaceAll("_", " ");
}

export function hasAnchorSignals(row) {
  return Boolean(
    row?.hcs_topic_id ||
      row?.hcs_transaction_id ||
      row?.hcs_message_id ||
      row?.hts_transaction_id
  );
}

export function certificateTrustState(row) {
  if (row?.mirror_verified) return "verified";
  if (hasAnchorSignals(row)) return "anchored";
  return "unanchored";
}

export function certificateTrustVariant(trust) {
  switch (trust) {
    case "verified":
      return "success";
    case "anchored":
      return "outline";
    case "unanchored":
      return "warn";
    default:
      return "outline";
  }
}

export function certificateTrustLabel(trust) {
  switch (trust) {
    case "verified":
      return "mirror verified";
    case "anchored":
      return "anchor observed";
    case "unanchored":
      return "not observed";
    default:
      return trust || "unknown";
  }
}

export function toProofDateParam(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return "";

  return new Date(ms).toISOString().slice(0, 10);
}

export function summarizeCertificateSubject(row) {
  const subject =
    row?.certificate?.subject ??
    row?.attributes?.certificate?.subject ??
    row?.metadata?.subject ??
    row?.subject ??
    {};

  if (!isPlainObject(subject)) return "No subject summary";

  const kind = String(row?.certificate_kind || row?.metadata?.certificate_kind || "").trim();

  if (kind === "dataset_certificate") {
    const datasetKey = String(subject.dataset_key || "").trim();
    const version = subject.version != null ? String(subject.version).trim() : "";
    const datasetVersionId = String(subject.dataset_version_id || "").trim();

    if (datasetKey && version) return `${datasetKey}@${version}`;
    if (datasetVersionId) return `dataset version ${shortId(datasetVersionId)}`;
    if (datasetKey) return datasetKey;
  }

  if (kind === "merkle_anchor_certificate") {
    const anchorRequestId = String(subject.anchor_request_id || "").trim();
    const rootId = String(subject.root_id || "").trim();
    const rootHash = String(subject.root_hash || "").trim();

    if (anchorRequestId) return `anchor request ${shortId(anchorRequestId)}`;
    if (rootId) return `root ${shortId(rootId)}`;
    if (rootHash) return `root hash ${shortHash(rootHash)}`;
  }

  if (kind === "ingest_certificate") {
    const objectKey = String(subject.object_key || "").trim();
    const datasetKey = String(subject.dataset_key || "").trim();
    const datasetVersionId = String(subject.dataset_version_id || "").trim();

    if (objectKey) return objectKey;
    if (datasetKey) return datasetKey;
    if (datasetVersionId) return `dataset version ${shortId(datasetVersionId)}`;
  }

  const pairs = Object.entries(subject)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v)}`);

  return pairs.length ? pairs.join(" • ") : "No subject summary";
}

export function certificateMatchesQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const subject =
    row?.certificate?.subject ??
    row?.attributes?.certificate?.subject ??
    row?.metadata?.subject ??
    row?.subject ??
    {};

  const haystack = [
    row?.nft_id,
    row?.id,
    row?.entity_id,
    row?.token_id,
    row?.serial_number,
    row?.proof_date,
    row?.certificate_kind,
    row?.token_purpose,
    row?.status,
    row?.wallet_address,
    row?.hcs_topic_id,
    row?.hcs_transaction_id,
    row?.hcs_message_id,
    row?.hts_transaction_id,
    summarizeCertificateSubject(row),
    isPlainObject(subject) ? JSON.stringify(subject) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

export function normalizeCertificatesEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  const certificates =
    Array.isArray(root?.certificates)
      ? root.certificates
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root)
          ? root
          : [];

  const page = isPlainObject(root?.page) ? root.page : {};
  const total = Number(page?.total ?? certificates.length) || 0;

  return {
    certificates,
    page,
    total,
  };
}

export function isCertificateRowLike(v) {
  return Boolean(
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    (
      v.nft_id != null ||
      v.proof_date != null ||
      v.token_id != null ||
      v.certificate_kind != null ||
      v.wallet_address != null
    )
  );
}

export function extractCertificateFromPayload(payload) {
  const root = payload?.result ?? payload ?? null;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;

  if (isCertificateRowLike(root)) return root;

  if (isCertificateRowLike(root?.certificate)) return root.certificate;

  if (root.certificate && typeof root.certificate === "object" && !Array.isArray(root.certificate)) {
    return root.certificate;
  }

  return root;
}

export function extractExistingCheckFromPayload(payload) {
  const root = payload?.result ?? payload ?? null;
  if (root && typeof root === "object" && !Array.isArray(root)) return root;
  return {};
}

export function getCertificateHoldingGroup(row) {
  const tokenId = String(row?.token_id || "").trim();
  const kind = String(row?.certificate_kind || "").trim();

  if (
    tokenId === CERTIFICATE_TOKEN_CONFIG.dataset_certificate.tokenId ||
    kind === "dataset_certificate"
  ) {
    return "dataset_certificate";
  }

  if (
    tokenId === CERTIFICATE_TOKEN_CONFIG.merkle_anchor_certificate.tokenId ||
    kind === "merkle_anchor_certificate"
  ) {
    return "merkle_anchor_certificate";
  }

  return "other";
}

export function groupCertificatesByHolding(rows) {
  const list = Array.isArray(rows) ? rows : [];

  const groups = {
    dataset_certificate: [],
    merkle_anchor_certificate: [],
    other: [],
  };

  for (const row of list) {
    groups[getCertificateHoldingGroup(row)].push(row);
  }

  return groups;
}

export function sortCertificatesNewestFirst(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const aTime =
      Date.parse(a?.minted_at || a?.created_at || a?.updated_at || "") || 0;
    const bTime =
      Date.parse(b?.minted_at || b?.created_at || b?.updated_at || "") || 0;
    return bTime - aTime;
  });
}

export function CertificateKindBadge({ kind }) {
  return <Badge variant={certificateKindVariant(kind)}>{certificateKindLabel(kind)}</Badge>;
}

export function CertificateStatusBadge({ status }) {
  return (
    <Badge variant={certificateStatusVariant(status)}>
      {certificateStatusLabel(status)}
    </Badge>
  );
}

export function CertificateTrustBadge({ row }) {
  const trust = certificateTrustState(row);
  return <Badge variant={certificateTrustVariant(trust)}>{certificateTrustLabel(trust)}</Badge>;
}

export function CertificateMirrorBadge({ row }) {
  return (
    <MirrorStatusPill
      hasAnchor={hasAnchorSignals(row)}
      mirrorVerified={Boolean(row?.mirror_verified)}
      failed={String(row?.status || "").trim().toLowerCase() === "mint_failed"}
      size="md"
    />
  );
}