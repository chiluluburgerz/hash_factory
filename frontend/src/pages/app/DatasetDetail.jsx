import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  RefreshCw,
  Database,
  ShieldCheck,
  Link2,
  FileCheck2,
  Globe,
  Lock,
  Building2,
  FolderUp,
  Award,
  ScrollText,
  ExternalLink,
  Package,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function extractRoot(payload) {
  return payload?.result ?? payload ?? null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickFirstObject(...vals) {
  for (const v of vals) {
    if (isPlainObject(v)) return v;
  }
  return null;
}

function pickFirstValue(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function pickFirstNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeProofDate(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function formatDateTime(value) {
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

function formatRelative(value) {
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

function getVisibility(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value === "organization" || value === "organization_only") return "org";
  return value;
}

function visibilityVariant(visibility) {
  switch (visibility) {
    case "public":
      return "success";
    case "org":
      return "outline";
    case "private":
      return "warn";
    default:
      return "outline";
  }
}

function visibilityLabel(visibility) {
  switch (visibility) {
    case "public":
      return "Public";
    case "org":
      return "Org";
    case "private":
      return "Private";
    default:
      return visibility || "Unknown";
  }
}

function getStatus(dataset, activeVersion) {
  const explicit = String(
    dataset?.status ||
      dataset?.lifecycle_status ||
      activeVersion?.status ||
      activeVersion?.lifecycle_status ||
      ""
  )
    .trim()
    .toLowerCase();

  if (explicit) return explicit;
  if (dataset?.is_disabled === true || dataset?.disabled === true) return "disabled";
  return "active";
}

function statusVariant(status) {
  switch (status) {
    case "active":
    case "ready":
    case "published":
      return "success";
    case "processing":
    case "pending":
    case "building":
      return "warn";
    case "disabled":
    case "archived":
    case "failed":
    case "error":
      return "outline";
    default:
      return "outline";
  }
}

function statusLabel(status) {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ");
}

function getTrustState(dataset, activeVersion) {
  if (dataset?.mirror_verified || activeVersion?.mirror_verified) return "verified";

  if (
    dataset?.dataset_hcs_topic_id ||
    dataset?.dataset_hcs_transaction_id ||
    dataset?.dataset_hcs_message_id ||
    activeVersion?.version_hcs_topic_id ||
    activeVersion?.version_hcs_transaction_id ||
    activeVersion?.version_hcs_message_id ||
    activeVersion?.hcs_topic_id ||
    activeVersion?.hcs_transaction_id ||
    activeVersion?.hcs_message_id
  ) {
    return "anchored";
  }

  return "unanchored";
}

function trustVariant(trust) {
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

function trustLabel(trust) {
  switch (trust) {
    case "verified":
      return "Verified";
    case "anchored":
      return "Anchored";
    case "unanchored":
      return "Unanchored";
    default:
      return trust || "Unknown";
  }
}

function normalizeDatasetBundle(datasetPayload, manifestPayload, activeVersionPayload) {
  const datasetRoot = extractRoot(datasetPayload);
  const manifestRoot = extractRoot(manifestPayload);
  const activeVersionRoot = extractRoot(activeVersionPayload);

  const dataset =
    pickFirstObject(
      datasetRoot?.core?.dataset,
      datasetRoot?.dataset,
      datasetRoot?.item,
      datasetRoot
    ) || {};

  const activeVersion =
    pickFirstObject(
      activeVersionRoot?.core?.version,
      activeVersionRoot?.version,
      activeVersionRoot?.item,
      activeVersionRoot,
      datasetRoot?.core?.version
    ) || {};

  const manifest =
    pickFirstObject(
      manifestRoot?.manifest,
      manifestRoot?.item,
      manifestRoot,
      datasetRoot?.core?.dataset,
      datasetRoot?.dataset
    ) || {};

  const published =
    pickFirstObject(datasetRoot?.core?.published, datasetRoot?.published) || {};

  const certificate =
    pickFirstObject(datasetRoot?.certificate, datasetRoot?.core?.certificate) || {};

  return {
    raw: {
      datasetRoot,
      manifestRoot,
      activeVersionRoot,
    },
    dataset,
    manifest,
    activeVersion,
    published,
    certificate,
  };
}

function buildDatasetCertificateLookup(bundle) {
  const dataset = bundle?.dataset || {};
  const activeVersion = bundle?.activeVersion || {};

  const proof_date = normalizeProofDate(activeVersion?.sealed_at || activeVersion?.created_at);

  const dataset_version_id =
    activeVersion?.id || activeVersion?.dataset_version_id || activeVersion?.version_id || null;

  const dataset_key = activeVersion?.dataset_key || dataset?.dataset_key || null;

  const version = activeVersion?.version ?? activeVersion?.dataset_version ?? null;

  if (!proof_date || !dataset_key || version == null) {
    return null;
  }

  return {
    proof_date,
    subject: {
      dataset_version_id: dataset_version_id || null,
      dataset_key,
      version,
      manifest_hash: activeVersion?.manifest_hash || null,
      schema_hash: activeVersion?.schema_hash || null,
      dataset_fingerprint: activeVersion?.dataset_fingerprint || null,
      row_count: activeVersion?.row_count ?? null,
      col_count: activeVersion?.col_count ?? null,
      bytes_estimate: activeVersion?.bytes_estimate ?? activeVersion?.artifact_bytes ?? null,
      hcs_topic_id: activeVersion?.version_hcs_topic_id || activeVersion?.hcs_topic_id || null,
      hcs_message_id:
        activeVersion?.version_hcs_message_id || activeVersion?.hcs_message_id || null,
    },
  };
}

function summarizePublicationState(publishedDataset, publishedVersion) {
  const datasetVisible = Boolean(
    publishedDataset?.entity_id || publishedDataset?.proof_date || publishedDataset?.created_at
  );
  const versionVisible = Boolean(
    publishedVersion?.entity_id || publishedVersion?.proof_date || publishedVersion?.created_at
  );

  if (datasetVisible && versionVisible) return "Dataset and active version are published.";
  if (datasetVisible) return "Dataset-level publication is visible.";
  if (versionVisible) return "Active version publication is visible.";
  return "No publication payload is currently visible.";
}

export default function DatasetDetailPage() {
  const { datasetKey } = useParams();

  const [bundle, setBundle] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const loadDataset = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const encodedKey = encodeURIComponent(String(datasetKey || "").trim());

      const [datasetPayload, manifestPayload, activeVersionPayload] = await Promise.all([
        fetchJsonOrThrow(`/datasets/${encodedKey}`),
        fetchJsonOrThrow(`/datasets/${encodedKey}/manifest/active`).catch(() => null),
        fetchJsonOrThrow(`/datasets/${encodedKey}/active-version-row`).catch(() => null),
      ]);

      const normalized = normalizeDatasetBundle(
        datasetPayload,
        manifestPayload,
        activeVersionPayload
      );

      if (!normalized?.dataset || !pickFirstValue(normalized.dataset?.dataset_key, datasetKey)) {
        throw new Error("Dataset not found.");
      }

      const certificateLookup = buildDatasetCertificateLookup(normalized);

      let resolvedCertificate = null;
      let resolvedCertificateExists = false;

      if (certificateLookup) {
        const existingPayload = await fetchJsonOrThrow("/v1/certificates/existing", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            certificate_kind: "dataset_certificate",
            proof_date: certificateLookup.proof_date,
            subject: certificateLookup.subject,
          }),
        }).catch(() => null);

        resolvedCertificateExists = Boolean(existingPayload?.result?.exists);
        resolvedCertificate = existingPayload?.result?.nft || null;
      }

      setBundle({
        ...normalized,
        resolvedCertificateLookup: certificateLookup,
        resolvedCertificateExists,
        resolvedCertificate,
      });
    } catch (err) {
      setBundle(null);
      setPageError(err?.message || "Failed to load dataset.");
    } finally {
      setIsLoading(false);
    }
  }, [datasetKey]);

  React.useEffect(() => {
    void loadDataset();
  }, [loadDataset]);

  const dataset = bundle?.dataset || {};
  const manifest = bundle?.manifest || {};
  const activeVersion = bundle?.activeVersion || {};
  const published = bundle?.published || {};
  const certificate = bundle?.certificate || {};
  const resolvedCertificate = bundle?.resolvedCertificate || null;
  const resolvedCertificateLookup = bundle?.resolvedCertificateLookup || null;
  const resolvedCertificateExists = Boolean(bundle?.resolvedCertificateExists);

  const resolvedDatasetKey = String(
    pickFirstValue(
      dataset?.dataset_key,
      manifest?.dataset_key,
      activeVersion?.dataset_key,
      datasetKey
    ) || ""
  );

  const displayName = String(
    pickFirstValue(
      dataset?.display_name,
      dataset?.dataset_label,
      manifest?.display_name,
      manifest?.dataset_label,
      resolvedDatasetKey,
      "Dataset detail"
    )
  );

  const visibility = getVisibility(pickFirstValue(dataset?.visibility, manifest?.visibility));
  const status = getStatus(dataset, activeVersion);
  const trust = getTrustState(dataset, activeVersion);

  const activeVersionNumber = pickFirstValue(
    dataset?.active_version,
    activeVersion?.version,
    activeVersion?.dataset_version,
    "—"
  );

  const datasetFingerprint = pickFirstValue(
    dataset?.dataset_fingerprint,
    activeVersion?.dataset_fingerprint,
    manifest?.dataset_fingerprint,
    activeVersion?.fingerprint_hash,
    activeVersion?.fingerprint,
    "—"
  );

  const manifestHash = pickFirstValue(
    dataset?.active_manifest_hash,
    activeVersion?.manifest_hash,
    dataset?.manifest_hash,
    manifest?.manifest_hash,
    "—"
  );

  const schemaHash = pickFirstValue(
    activeVersion?.schema_hash,
    dataset?.schema_hash,
    manifest?.schema_hash,
    "—"
  );

  const bytesEstimate = pickFirstNumber(
    activeVersion?.bytes_estimate,
    dataset?.bytes_estimate,
    activeVersion?.artifact_bytes,
    dataset?.artifact_bytes
  );

  const rowCount = pickFirstNumber(activeVersion?.row_count, dataset?.row_count);
  const colCount = pickFirstNumber(activeVersion?.col_count, dataset?.col_count);

  const datasetHcsTopicId = pickFirstValue(dataset?.dataset_hcs_topic_id, dataset?.hcs_topic_id, "—");

  const datasetHcsTransactionId = pickFirstValue(
    dataset?.dataset_hcs_transaction_id,
    dataset?.hcs_transaction_id,
    "—"
  );

  const datasetHcsMessageId = pickFirstValue(
    dataset?.dataset_hcs_message_id,
    dataset?.hcs_message_id,
    "—"
  );

  const versionHcsTopicId = pickFirstValue(
    activeVersion?.version_hcs_topic_id,
    activeVersion?.hcs_topic_id,
    "—"
  );

  const versionHcsTransactionId = pickFirstValue(
    activeVersion?.version_hcs_transaction_id,
    activeVersion?.hcs_transaction_id,
    "—"
  );

  const versionHcsMessageId = pickFirstValue(
    activeVersion?.version_hcs_message_id,
    activeVersion?.hcs_message_id,
    "—"
  );

  const ingestSource = pickFirstValue(dataset?.ingest_source, activeVersion?.ingest_source, "—");

  const evidencePointer = pickFirstValue(
    bundle?.raw?.datasetRoot?.receipt?.pointers?.evidence_pointer,
    manifest?.matrix_path,
    activeVersion?.matrix_path,
    dataset?.matrix_path,
    "—"
  );

  const createdAt = pickFirstValue(dataset?.created_at, manifest?.created_at);
  const updatedAt = pickFirstValue(dataset?.updated_at, manifest?.updated_at);
  const sealedAt = pickFirstValue(activeVersion?.sealed_at, dataset?.sealed_at);

  const publishedDataset = published?.published?.dataset || {};
  const publishedVersion = published?.published?.dataset_version || {};

  const certificateIssued = Boolean(
    resolvedCertificateExists ||
      resolvedCertificate?.nft_id ||
      certificate?.issued ||
      certificate?.certificate?.issued ||
      certificate?.ok
  );

  const certificateNft = resolvedCertificate || certificate?.certificate?.nft || certificate?.nft || null;

  const certificatePayload = certificate?.certificate?.certificate || certificate?.certificate || null;

  const certificateProofDate =
    resolvedCertificateLookup?.proof_date ||
    certificateNft?.proof_date ||
    certificatePayload?.proof_date ||
    null;

  const certificateDetailHref =
    certificateNft?.nft_id && certificateProofDate
      ? `/app/certificates/${encodeURIComponent(certificateNft.nft_id)}/${encodeURIComponent(
          certificateProofDate
        )}`
      : null;

  const trustIcon =
    visibility === "public"
      ? Globe
      : visibility === "org"
        ? Building2
        : visibility === "private"
          ? Lock
          : Database;

  const publicationSummary = summarizePublicationState(publishedDataset, publishedVersion);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/datasets" className="hover:underline">
              Datasets
            </Link>
            <span className="mx-2">/</span>
            <span>Detail</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{displayName}</h1>

          <p className="font-mono text-sm text-muted-foreground break-all">
            {resolvedDatasetKey || datasetKey || "unknown"}
          </p>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Review the current registered dataset state, active material binding, trust-layer
            anchors, publication posture, and certificate outcome for this dataset.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadDataset()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/datasets/anchor">
              <FolderUp className="mr-2 h-4 w-4" />
              Guided anchor
            </Link>
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/datasets/submit">
              <ScrollText className="mr-2 h-4 w-4" />
              Local-first submit
            </Link>
          </Button>

          {certificateDetailHref ? (
            <Button asChild>
              <Link to={certificateDetailHref}>
                <Award className="mr-2 h-4 w-4" />
                Open certificate
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading dataset...
        </div>
      ) : !bundle ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Dataset not found.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Visibility"
              value={visibilityLabel(visibility)}
              hint="Current registry visibility for this dataset."
              icon={trustIcon}
            />

            <EntitySummaryCard
              title="Trust state"
              value={trustLabel(trust)}
              hint="Observed trust posture from the dataset row and the active version anchor state."
              icon={Link2}
            />

            <EntitySummaryCard
              title="Active version"
              value={String(activeVersionNumber)}
              hint={sealedAt ? `Sealed ${formatRelative(sealedAt)}` : "Current active dataset version."}
              icon={ShieldCheck}
            />

            <EntitySummaryCard
              title="Certificate"
              value={certificateIssued ? "Issued" : "Not issued"}
              hint={
                certificateIssued
                  ? "A dataset certificate was deterministically resolved for the active dataset version."
                  : "No dataset certificate was resolved for the active dataset version."
              }
              icon={Award}
            />
          </div>

          <EntitySection
            title="Overview"
            description="The shortest useful reading of this dataset for a judge, partner, or operator."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">Registry posture</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  This dataset is currently <span className="font-medium text-foreground/90">{visibilityLabel(visibility)}</span>{" "}
                  and its operational status is <span className="font-medium text-foreground/90">{statusLabel(status)}</span>.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">Trust posture</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  The active dataset state is currently assessed as{" "}
                  <span className="font-medium text-foreground/90">{trustLabel(trust)}</span>{" "}
                  based on observed HCS linkage and mirror-visible signals.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">Release posture</div>
                <p className="mt-2 text-sm text-muted-foreground">{publicationSummary}</p>
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Dataset record"
            description="Stable registry identity and current dataset-level posture for this record."
          >
            <div className="mb-4 flex flex-wrap gap-3">
              <Badge variant={visibilityVariant(visibility)}>{visibilityLabel(visibility)}</Badge>
              <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
              <Badge variant={trustVariant(trust)}>{trustLabel(trust)}</Badge>
              <Badge variant={certificateIssued ? "success" : "outline"}>
                {certificateIssued ? "Certificate issued" : "Certificate not issued"}
              </Badge>
            </div>

            <EntityKeyValueGrid
              items={[
                { key: "dataset_key", label: "Dataset key", value: resolvedDatasetKey, mono: true },
                { key: "display_name", label: "Display name", value: displayName },
                { key: "program", label: "Program", value: dataset?.program || manifest?.program || "—" },
                { key: "org_id", label: "Org id", value: dataset?.org_id, mono: true },
                { key: "owner_user_id", label: "Owner user id", value: dataset?.owner_user_id, mono: true },
                { key: "visibility", label: "Visibility", value: visibilityLabel(visibility) },
                { key: "status", label: "Status", value: statusLabel(status) },
                { key: "ingest_source", label: "Ingest source", value: ingestSource },
                { key: "created_at", label: "Created at", value: formatDateTime(createdAt) },
                { key: "updated_at", label: "Updated at", value: formatDateTime(updatedAt) },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Active material state"
            description="Current active version and the material fingerprint state bound to this dataset key."
          >
            <EntityKeyValueGrid
              items={[
                { key: "active_version", label: "Version", value: String(activeVersionNumber) },
                { key: "version_id", label: "Version id", value: activeVersion?.id, mono: true },
                {
                  key: "dataset_fingerprint",
                  label: "Dataset fingerprint",
                  value: datasetFingerprint,
                  mono: true,
                },
                { key: "manifest_hash", label: "Manifest hash", value: manifestHash, mono: true },
                { key: "schema_hash", label: "Schema hash", value: schemaHash, mono: true },
                {
                  key: "bytes_estimate",
                  label: "Bytes estimate",
                  value: bytesEstimate != null ? Number(bytesEstimate).toLocaleString() : "—",
                },
                {
                  key: "row_count",
                  label: "Row count",
                  value: rowCount != null ? Number(rowCount).toLocaleString() : "—",
                },
                {
                  key: "col_count",
                  label: "Column count",
                  value: colCount != null ? Number(colCount).toLocaleString() : "—",
                },
                { key: "sealed_at", label: "Sealed at", value: formatDateTime(sealedAt) },
                { key: "matrix_path", label: "Artifact pointer", value: evidencePointer, mono: true },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Trust and anchors"
            description="Observed HCS linkage for the dataset record and active version."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <EntityKeyValueGrid
                title="Dataset anchor"
                items={[
                  { key: "dataset_hcs_topic_id", label: "Topic id", value: datasetHcsTopicId, mono: true },
                  {
                    key: "dataset_hcs_transaction_id",
                    label: "Transaction id",
                    value: datasetHcsTransactionId,
                    mono: true,
                  },
                  {
                    key: "dataset_hcs_message_id",
                    label: "Message id",
                    value: datasetHcsMessageId,
                    mono: true,
                  },
                ]}
              />

              <EntityKeyValueGrid
                title="Active version anchor"
                items={[
                  { key: "version_hcs_topic_id", label: "Topic id", value: versionHcsTopicId, mono: true },
                  {
                    key: "version_hcs_transaction_id",
                    label: "Transaction id",
                    value: versionHcsTransactionId,
                    mono: true,
                  },
                  {
                    key: "version_hcs_message_id",
                    label: "Message id",
                    value: versionHcsMessageId,
                    mono: true,
                  },
                ]}
              />
            </div>
          </EntitySection>

          <EntitySection
            title="Certificate"
            description="Deterministically resolved dataset certificate state for the active version."
          >
            {!certificateIssued && !certificateNft ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                No dataset certificate was resolved for the current active version.
              </div>
            ) : (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <EntityKeyValueGrid
                    title="Certificate summary"
                    items={[
                      { key: "issued", label: "Issued", value: certificateIssued ? "true" : "false" },
                      {
                        key: "nft_id",
                        label: "NFT id",
                        value: certificateNft?.nft_id || certificateNft?.id || "—",
                        mono: true,
                      },
                      { key: "program", label: "Program", value: certificateNft?.program || "—" },
                      {
                        key: "wallet_address",
                        label: "Wallet address",
                        value: certificateNft?.wallet_address || "—",
                        mono: true,
                      },
                      { key: "token_id", label: "Token id", value: certificateNft?.token_id || "—", mono: true },
                      {
                        key: "serial_number",
                        label: "Serial number",
                        value:
                          certificateNft?.serial_number != null
                            ? String(certificateNft.serial_number)
                            : "—",
                      },
                      { key: "proof_date", label: "Proof date", value: certificateProofDate || "—" },
                      { key: "minted_at", label: "Minted at", value: formatDateTime(certificateNft?.minted_at) },
                      {
                        key: "hcs_transaction_id",
                        label: "Certificate HCS txn",
                        value: certificateNft?.hcs_transaction_id || "—",
                        mono: true,
                      },
                      {
                        key: "hts_transaction_id",
                        label: "Certificate HTS txn",
                        value: certificateNft?.hts_transaction_id || "—",
                        mono: true,
                      },
                    ]}
                  />

                  <EntityKeyValueGrid
                    title="Certificate hashes"
                    items={[
                      {
                        key: "result_hash",
                        label: "Result hash",
                        value: certificateNft?.result_hash || "—",
                        mono: true,
                      },
                      {
                        key: "nft_hash",
                        label: "NFT hash",
                        value: certificateNft?.nft_hash || "—",
                        mono: true,
                      },
                      {
                        key: "global_hash",
                        label: "Global hash",
                        value: certificateNft?.global_hash || "—",
                        mono: true,
                      },
                      {
                        key: "payload_hash",
                        label: "Payload hash",
                        value: certificatePayload?.payload_hash || "—",
                        mono: true,
                      },
                      {
                        key: "identity_hash",
                        label: "Identity hash",
                        value: certificatePayload?.identity_hash || "—",
                        mono: true,
                      },
                      { key: "proof_date_hash", label: "Proof date", value: certificateProofDate || "—" },
                    ]}
                  />
                </div>

                {certificateDetailHref ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild>
                      <Link to={certificateDetailHref}>
                        <Award className="mr-2 h-4 w-4" />
                        Open certificate detail
                      </Link>
                    </Button>

                    <Button asChild variant="outline">
                      <Link to="/app/certificates">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View all certificates
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </EntitySection>

          <EntitySection
            title="Metadata and raw structures"
            description="Lower-level payloads visible to the current authenticated actor."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Dataset metadata
                </div>
                <JsonBlock value={dataset?.metadata} emptyLabel="No dataset metadata" />
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Metadata schema
                </div>
                <JsonBlock
                  value={pickFirstObject(
                    activeVersion?.metadata_schema,
                    dataset?.metadata_schema,
                    manifest?.metadata_schema
                  )}
                  emptyLabel="No metadata schema"
                />
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Publication payload
                </div>
                <JsonBlock value={published} emptyLabel="No publication payload" />
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Legacy embedded certificate payload
                </div>
                <JsonBlock value={certificate} emptyLabel="No embedded certificate payload" />
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="What this page tells you"
            description="This is the inspection surface for a single dataset record."
          >
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <Database className="h-4 w-4" />
                  Stable identity
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  The dataset key is the durable registry identity. This record is the long-lived
                  object that downstream workflows reference.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <FileCheck2 className="h-4 w-4" />
                  Active material state
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  The active version, dataset fingerprint, manifest hash, schema hash, and artifact
                  pointer describe the current material state bound to this dataset key.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <Link2 className="h-4 w-4" />
                  Trust posture
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Dataset and version HCS linkage show whether lifecycle events for this record have
                  been anchored into the trust layer.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <ExternalLink className="h-4 w-4" />
                  Release state
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  This page shows what an evaluator needs to know: what the dataset is, what version
                  is active, how it was anchored, whether it was published, and whether a
                  certificate exists.
                </p>
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Current dataset posture"
            description="How this dataset fits into the current HF product model."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <FolderUp className="h-4 w-4" />
                  Managed guided flow
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Guided anchor is the managed path for demos, operator-assisted runs, and early
                  partner onboarding where HF can access the dataset root directly.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <Package className="h-4 w-4" />
                  Local-first bridge
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Local-first submit is the bridge for users who compute deterministic evidence
                  outside HF and then finalize anchored registry state through the platform.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <ScrollText className="h-4 w-4" />
                  Inspection surface
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  This detail page is where users review identity, trust state, publication posture,
                  and certificate output after either workflow completes.
                </p>
              </div>
            </div>
          </EntitySection>
        </>
      )}
    </div>
  );
}