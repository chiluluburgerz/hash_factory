import React from "react";
import { Badge } from "@/components/base/badge";

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
  return Boolean(row?.hcs_topic_id || row?.hcs_transaction_id);
}

export function hasMintSignals(row) {
  return Boolean(row?.hts_transaction_id || row?.minted_at || row?.serial_number != null);
}

export function certificateTrustState(row) {
  if (hasAnchorSignals(row)) return "anchored";
  return "unanchored";
}

export function certificateTrustVariant(trust) {
  switch (trust) {
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
    case "anchored":
      return "anchor observed";
    case "unanchored":
      return "not anchored";
    default:
      return trust || "unknown";
  }
}

function getCompactCertificate(row) {
  const compact =
    row?.certificate ??
    row?.attributes?.certificate ??
    null;

  return isPlainObject(compact) ? compact : {};
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
    null;

  const kind = String(row?.certificate_kind || row?.metadata?.certificate_kind || "").trim();

  if (isPlainObject(subject)) {
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
  }

  const compact = getCompactCertificate(row);
  const subjectRef =
    String(
      compact?.subject_ref ??
      compact?.sr ??
      row?.metadata?.subject_ref ??
      ""
    ).trim();

  if (subjectRef) {
    if (kind === "dataset_certificate") return `Dataset ${subjectRef}`;
    if (kind === "merkle_anchor_certificate") return `Merkle anchor ${subjectRef}`;
    return subjectRef;
  }

  if (kind === "dataset_certificate") return "Dataset certificate";
  if (kind === "merkle_anchor_certificate") return "Merkle anchor certificate";
  return "Certificate";
}

export function certificateMatchesQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const status = getCertificateStatus(row);
  const subject = summarizeCertificateSubject(row);
  const haystack = [
    row?.certificate_kind,
    row?.token_purpose,
    row?.token_id,
    row?.wallet_address,
    row?.nft_id,
    row?.id,
    row?.entity_id,
    row?.serial_number,
    row?.proof_date,
    row?.hcs_topic_id,
    row?.hcs_transaction_id,
    row?.hts_transaction_id,
    status,
    subject,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");

  return haystack.includes(q);
}

export function normalizeCertificatesEnvelope(payload) {
  const p = payload?.result ?? payload ?? {};
  const certificates = Array.isArray(p?.certificates)
    ? p.certificates
    : Array.isArray(p?.rows)
      ? p.rows
      : Array.isArray(p)
        ? p
        : [];

  return {
    certificates,
    total: p?.total ?? certificates.length,
  };
}

export function extractCertificateFromPayload(payload) {
  return payload?.result ?? payload ?? null;
}

export function sortCertificatesNewestFirst(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const aTs = Date.parse(a?.minted_at || a?.created_at || a?.proof_date || 0);
    const bTs = Date.parse(b?.minted_at || b?.created_at || b?.proof_date || 0);
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  });
}

export function groupCertificatesByHolding(rows) {
  const buckets = {
    dataset_certificate: [],
    merkle_anchor_certificate: [],
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = String(row?.certificate_kind || "").trim();
    if (buckets[kind]) buckets[kind].push(row);
  }

  return buckets;
}

export function CertificateKindBadge({ kind }) {
  return <Badge variant={certificateKindVariant(kind)}>{certificateKindLabel(kind)}</Badge>;
}

export function CertificateStatusBadge({ status }) {
  return <Badge variant={certificateStatusVariant(status)}>{certificateStatusLabel(status)}</Badge>;
}

export function CertificateTrustBadge({ row }) {
  const trust = certificateTrustState(row);
  return <Badge variant={certificateTrustVariant(trust)}>{certificateTrustLabel(trust)}</Badge>;
}