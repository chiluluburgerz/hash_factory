import React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  RefreshCw,
  ShieldCheck,
  Database,
  Fingerprint,
  ScrollText,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import {
  CertificateKindBadge,
  CertificateStatusBadge,
  CertificateTrustBadge,
  extractCertificateFromPayload,
  summarizeCertificateSubject,
  getCertificateStatus,
  formatDateTime,
  formatRelative,
  formatDateOnly,
  isPlainObject,
  toProofDateParam,
} from "@/components/certificates/certificate-ui.jsx";

function getSubject(row) {
  const subject =
    row?.certificate?.subject ??
    row?.attributes?.certificate?.subject ??
    row?.metadata?.subject ??
    row?.subject ??
    null;

  return isPlainObject(subject) ? subject : {};
}

function getCompactCertificate(row) {
  const compact = row?.certificate ?? row?.attributes?.certificate ?? {};
  return isPlainObject(compact) ? compact : {};
}

function getMetadata(row) {
  return isPlainObject(row?.metadata) ? row.metadata : {};
}

function getAttributes(row) {
  return isPlainObject(row?.attributes) ? row.attributes : {};
}

function getSubjectSummary(row) {
  const helperSummary = summarizeCertificateSubject(row);
  if (helperSummary && helperSummary !== "No subject summary") {
    return helperSummary;
  }

  const compact = getCompactCertificate(row);
  const subjectRef =
    compact?.subject_ref ??
    compact?.sr ??
    getMetadata(row)?.subject_ref ??
    null;

  const kind = String(row?.certificate_kind || "").trim();

  if (subjectRef) {
    if (kind === "merkle_anchor_certificate") return `Merkle anchor ${subjectRef}`;
    if (kind === "dataset_certificate") return `Dataset ${subjectRef}`;
    return subjectRef;
  }

  if (kind === "merkle_anchor_certificate") return "Merkle anchor certificate";
  if (kind === "dataset_certificate") return "Dataset certificate";
  return "Certificate";
}

function getHcsTransactionId(row) {
  return row?.hcs_transaction_id ?? null;
}

function getHcsTopicId(row) {
  return row?.hcs_topic_id ?? null;
}

function getHtsTransactionId(row) {
  return row?.hts_transaction_id ?? null;
}

function isAnchored(row) {
  return Boolean(getHcsTransactionId(row) || getHcsTopicId(row));
}

export default function CertificateDetailPage() {
  const { certificateId, proofDate: proofDateParam } = useParams();
  const [searchParams] = useSearchParams();

  const proofDate = React.useMemo(() => {
    return toProofDateParam(proofDateParam) || toProofDateParam(searchParams.get("proof_date"));
  }, [proofDateParam, searchParams]);

  const [certificate, setCertificate] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const loadCertificate = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      if (!certificateId) {
        throw new Error("Certificate id is required.");
      }
      if (!proofDate) {
        throw new Error("Missing proof_date.");
      }

      const payload = await fetchJsonOrThrow(
        `/v1/certificates/${encodeURIComponent(certificateId)}/${encodeURIComponent(proofDate)}`
      );

      const row = extractCertificateFromPayload(payload);

      if (!row) {
        throw new Error("Certificate not found.");
      }

      setCertificate(row);
    } catch (err) {
      setCertificate(null);
      setPageError(err?.message || "Failed to load certificate.");
    } finally {
      setIsLoading(false);
    }
  }, [certificateId, proofDate]);

  React.useEffect(() => {
    void loadCertificate();
  }, [loadCertificate]);

  const compactCertificate = React.useMemo(() => getCompactCertificate(certificate), [certificate]);
  const subject = React.useMemo(() => getSubject(certificate), [certificate]);
  const metadata = React.useMemo(() => getMetadata(certificate), [certificate]);
  const attributes = React.useMemo(() => getAttributes(certificate), [certificate]);

  const certificatePayloadHash =
    compactCertificate?.certificate_payload_hash ??
    compactCertificate?.ch ??
    metadata?.certificate_payload_hash ??
    null;

  const identityHash =
    compactCertificate?.identity_hash ??
    compactCertificate?.ih ??
    metadata?.identity_hash ??
    null;

  const source =
    compactCertificate?.source ??
    compactCertificate?.src ??
    metadata?.source ??
    null;

  const subjectSummary = getSubjectSummary(certificate);
  const status = getCertificateStatus(certificate || {});
  const hcsTransactionId = getHcsTransactionId(certificate);
  const hcsTopicId = getHcsTopicId(certificate);
  const htsTransactionId = getHtsTransactionId(certificate);
  const showRawSubject = subject && Object.keys(subject).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/certificates" className="hover:underline">
              Certificates
            </Link>
            <span className="mx-2">/</span>
            <span>Detail</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Certificate Detail
          </h1>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Review ownership-linked identity, issuance state, HCS linkage, and deterministic proof
            fields for this certificate.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadCertificate()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/certificates">Back to certificates</Link>
          </Button>
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading certificate...
        </div>
      ) : !certificate ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Certificate not found.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <CertificateKindBadge kind={certificate?.certificate_kind} />
            <CertificateStatusBadge status={status} />
            <CertificateTrustBadge row={certificate} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Subject"
              value={subjectSummary}
              hint="Summary of what this certificate refers to."
              icon={ScrollText}
            />

            <EntitySummaryCard
              title="Proof date"
              value={formatDateOnly(certificate?.proof_date)}
              hint="The deterministic proof date in the certificate business identity."
              icon={Database}
            />

            <EntitySummaryCard
              title="Mint status"
              value={String(status || "unknown").replaceAll("_", " ")}
              hint={
                certificate?.minted_at
                  ? `Minted ${formatRelative(certificate.minted_at)}`
                  : "Mint lifecycle not completed or not visible."
              }
              icon={ShieldCheck}
            />

            <EntitySummaryCard
              title="Serial"
              value={certificate?.serial_number ? `#${certificate.serial_number}` : "—"}
              hint={certificate?.token_id || "No visible token id"}
              icon={Fingerprint}
            />
          </div>

          <EntitySection
            title="Identity"
            description="Core identity, ownership, and token-linked fields."
          >
            <EntityKeyValueGrid
              items={[
                { key: "nft_id", label: "NFT id", value: certificate?.nft_id || "—", mono: true },
                { key: "row_id", label: "Row id", value: certificate?.id || "—", mono: true },
                { key: "entity_id", label: "Entity id", value: certificate?.entity_id || "—", mono: true },
                {
                  key: "proof_date",
                  label: "Proof date",
                  value: formatDateOnly(certificate?.proof_date),
                },
                {
                  key: "kind",
                  label: "Certificate kind",
                  value: certificate?.certificate_kind || "—",
                },
                {
                  key: "token_purpose",
                  label: "Token purpose",
                  value: certificate?.token_purpose || metadata?.token_purpose || "—",
                },
                { key: "token_id", label: "Token id", value: certificate?.token_id || "—", mono: true },
                {
                  key: "serial_number",
                  label: "Serial number",
                  value: certificate?.serial_number != null ? String(certificate.serial_number) : "—",
                },
                {
                  key: "wallet_address",
                  label: "Wallet address",
                  value: certificate?.wallet_address || "—",
                  mono: true,
                },
                { key: "user_id", label: "User id", value: certificate?.user_id || "—", mono: true },
                { key: "org_id", label: "Org id", value: certificate?.org_id || "—", mono: true },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Anchor and issuance signals"
            description="Real HCS linkage and HTS lifecycle fields present on the NFT row."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div>
                  <div className="text-sm font-semibold text-foreground">HCS anchor</div>
                  <div className="text-xs text-muted-foreground">
                    Certificate-side HCS linkage visible on the NFT record.
                  </div>
                </div>

                <EntityKeyValueGrid
                  items={[
                    {
                      key: "anchor_status",
                      label: "Anchor status",
                      value: isAnchored(certificate) ? "anchor observed" : "not anchored",
                    },
                    {
                      key: "hcs_topic_id",
                      label: "HCS topic id",
                      value: hcsTopicId || "—",
                      mono: true,
                    },
                    {
                      key: "hcs_transaction_id",
                      label: "HCS transaction id",
                      value: hcsTransactionId || "—",
                      mono: true,
                    },
                  ]}
                />
              </div>

              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div>
                  <div className="text-sm font-semibold text-foreground">HTS lifecycle</div>
                  <div className="text-xs text-muted-foreground">
                    Mint transaction and NFT row lifecycle timestamps.
                  </div>
                </div>

                <EntityKeyValueGrid
                  items={[
                    {
                      key: "status",
                      label: "Status",
                      value: certificate?.status || "—",
                    },
                    {
                      key: "hts_transaction_id",
                      label: "HTS transaction id",
                      value: htsTransactionId || "—",
                      mono: true,
                    },
                    {
                      key: "minted_at",
                      label: "Minted at",
                      value: certificate?.minted_at ? formatDateTime(certificate.minted_at) : "—",
                    },
                    {
                      key: "created_at",
                      label: "Created at",
                      value: certificate?.created_at ? formatDateTime(certificate.created_at) : "—",
                    },
                    {
                      key: "updated_at",
                      label: "Updated at",
                      value: certificate?.updated_at ? formatDateTime(certificate.updated_at) : "—",
                    },
                  ]}
                />
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Hashes and deterministic identity"
            description="Primary proof identity and derived certificate hashes present on the NFT row."
          >
            <EntityKeyValueGrid
              items={[
                {
                  key: "certificate_payload_hash",
                  label: "Certificate payload hash",
                  value: certificatePayloadHash || "—",
                  mono: true,
                },
                {
                  key: "identity_hash",
                  label: "Identity hash",
                  value: identityHash || "—",
                  mono: true,
                },
                {
                  key: "result_hash",
                  label: "Result hash",
                  value: certificate?.result_hash || "—",
                  mono: true,
                },
                {
                  key: "nft_hash",
                  label: "NFT hash",
                  value: certificate?.nft_hash || "—",
                  mono: true,
                },
                {
                  key: "global_hash",
                  label: "Global hash",
                  value: certificate?.global_hash || "—",
                  mono: true,
                },
                {
                  key: "input_hash",
                  label: "Input hash",
                  value: certificate?.input_hash || "—",
                  mono: true,
                },
                {
                  key: "pipeline_hash",
                  label: "Pipeline hash",
                  value: certificate?.pipeline_hash || "—",
                  mono: true,
                },
                {
                  key: "params_hash",
                  label: "Params hash",
                  value: certificate?.params_hash || "—",
                  mono: true,
                },
                {
                  key: "service_hash",
                  label: "Service hash",
                  value: certificate?.service_hash || "—",
                  mono: true,
                },
                {
                  key: "source",
                  label: "Source",
                  value: source || "—",
                },
              ]}
            />
          </EntitySection>

          {showRawSubject ? (
            <EntitySection
              title="Certificate subject"
              description="Structured subject fields attached to this certificate when available."
            >
              <JsonBlock value={subject} />
            </EntitySection>
          ) : null}

          <EntitySection
            title="Compact certificate metadata"
            description="Compact certificate projection stored on the NFT attributes."
          >
            <JsonBlock value={compactCertificate} />
          </EntitySection>

          <EntitySection
            title="Metadata and attributes"
            description="Raw row metadata surfaces used by the certificate slice."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <JsonBlock value={metadata} />
              <JsonBlock value={attributes} />
            </div>
          </EntitySection>
        </>
      )}
    </div>
  );
}