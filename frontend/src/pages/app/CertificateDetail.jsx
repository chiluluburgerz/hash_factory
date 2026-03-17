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
  CertificateMirrorBadge,
  extractCertificateFromPayload,
  summarizeCertificateSubject,
  getCertificateStatus,
  formatDateTime,
  formatRelative,
  formatDateOnly,
  shortHash,
  isPlainObject,
  toProofDateParam,
} from "@/components/certificates/certificate-ui.jsx";
import {
  HcsTxLabel,
  HcsTxHashscanLink,
} from "@/components/hcs/hcs-tx-link.jsx";

function getSubject(row) {
  const subject =
    row?.certificate?.subject ??
    row?.attributes?.certificate?.subject ??
    row?.metadata?.subject ??
    row?.subject ??
    {};
  return isPlainObject(subject) ? subject : {};
}

function getCompactCertificate(row) {
  const compact =
    row?.certificate ??
    row?.attributes?.certificate ??
    {};
  return isPlainObject(compact) ? compact : {};
}

function getMetadata(row) {
  return isPlainObject(row?.metadata) ? row.metadata : {};
}

function getAttributes(row) {
  return isPlainObject(row?.attributes) ? row.attributes : {};
}

export default function CertificateDetailPage() {
  const { certificateId, proofDate: proofDateParam } = useParams();
  const [searchParams] = useSearchParams();

  const proofDate = React.useMemo(() => {
    return (
      toProofDateParam(proofDateParam) ||
      toProofDateParam(searchParams.get("proof_date"))
    );
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
    metadata?.certificate_payload_hash ??
    null;

  const identityHash =
    compactCertificate?.identity_hash ??
    metadata?.identity_hash ??
    null;

  const source =
    compactCertificate?.source ??
    metadata?.source ??
    null;

  const subjectSummary = summarizeCertificateSubject(certificate);
  const status = getCertificateStatus(certificate || {});

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
            Held Certificate Detail
          </h1>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Review the proof, trust signals, token identity, and metadata for a certificate currently visible in this authenticated user context.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadCertificate()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
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
            <CertificateMirrorBadge row={certificate} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Subject"
              value={subjectSummary}
              hint="Human-readable summary of the certificate subject identity."
              icon={ScrollText}
            />

            <EntitySummaryCard
              title="Proof date"
              value={formatDateOnly(certificate?.proof_date)}
              hint="The proof date used in the deterministic business identity."
              icon={Database}
            />

            <EntitySummaryCard
              title="Mint status"
              value={String(status || "unknown").replaceAll("_", " ")}
              hint={certificate?.minted_at ? `Minted ${formatRelative(certificate.minted_at)}` : "Mint lifecycle not completed or not visible."}
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
            description="Core identity, token, and ownership-linked fields."
          >
            <EntityKeyValueGrid
              items={[
                { key: "nft_id", label: "NFT id", value: certificate?.nft_id, mono: true },
                { key: "row_id", label: "Row id", value: certificate?.id, mono: true },
                { key: "entity_id", label: "Entity id", value: certificate?.entity_id, mono: true },
                { key: "proof_date", label: "Proof date", value: formatDateOnly(certificate?.proof_date) },
                { key: "kind", label: "Certificate kind", value: certificate?.certificate_kind || "—" },
                { key: "token_purpose", label: "Token purpose", value: certificate?.token_purpose || "—" },
                { key: "token_id", label: "Token id", value: certificate?.token_id || "—", mono: true },
                { key: "serial_number", label: "Serial number", value: certificate?.serial_number ? String(certificate.serial_number) : "—" },
                { key: "wallet_address", label: "Wallet address", value: certificate?.wallet_address || "—", mono: true },
                { key: "user_id", label: "User id", value: certificate?.user_id || "—", mono: true },
                { key: "org_id", label: "Org id", value: certificate?.org_id || "—", mono: true },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Trust and anchor signals"
            description="Observed HCS, HTS, and mirror signals."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">HCS / mirror</div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Mirror posture
                    </div>
                    <div className="mt-2">
                      <CertificateMirrorBadge row={certificate} />
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      HCS topic id
                    </div>
                    <div className="mt-2 font-mono text-xs text-foreground/90 break-all">
                      {certificate?.hcs_topic_id || "—"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      HCS transaction id
                    </div>
                    <div className="mt-2">
                      <HcsTxLabel id={certificate?.hcs_transaction_id} />
                    </div>
                    {certificate?.hcs_transaction_id ? (
                      <div className="mt-2">
                        <HcsTxHashscanLink id={certificate.hcs_transaction_id} />
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      HCS message id
                    </div>
                    <div className="mt-2 font-mono text-xs text-foreground/90 break-all">
                      {certificate?.hcs_message_id || "—"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Mirror verified at
                    </div>
                    <div className="mt-2 text-sm text-foreground/90">
                      {formatDateTime(certificate?.mirror_verified_at)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">HTS / lifecycle</div>

                <EntityKeyValueGrid
                  items={[
                    {
                      key: "status",
                      label: "Status",
                      value: status.replaceAll("_", " "),
                    },
                    {
                      key: "hts_transaction_id",
                      label: "HTS transaction id",
                      value: certificate?.hts_transaction_id || "—",
                      mono: true,
                    },
                    {
                      key: "minted_at",
                      label: "Minted at",
                      value: formatDateTime(certificate?.minted_at),
                    },
                    {
                      key: "created_at",
                      label: "Created at",
                      value: formatDateTime(certificate?.created_at),
                    },
                    {
                      key: "updated_at",
                      label: "Updated at",
                      value: formatDateTime(certificate?.updated_at),
                    },
                    {
                      key: "deleted_at",
                      label: "Deleted at",
                      value: formatDateTime(certificate?.deleted_at),
                    },
                  ]}
                />
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Hashes and deterministic identity"
            description="The fields that matter most for proof and reproducibility review."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">Primary hashes</div>
                <EntityKeyValueGrid
                  items={[
                    { key: "certificate_payload_hash", label: "Certificate payload hash", value: certificatePayloadHash ? shortHash(certificatePayloadHash) : "—", mono: true },
                    { key: "identity_hash", label: "Identity hash", value: identityHash ? shortHash(identityHash) : "—", mono: true },
                    { key: "result_hash", label: "Result hash", value: certificate?.result_hash ? shortHash(certificate.result_hash) : "—", mono: true },
                    { key: "nft_hash", label: "NFT hash", value: certificate?.nft_hash ? shortHash(certificate.nft_hash) : "—", mono: true },
                    { key: "global_hash", label: "Global hash", value: certificate?.global_hash ? shortHash(certificate.global_hash) : "—", mono: true },
                  ]}
                />
              </div>

              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-sm font-semibold text-foreground/90">Pipeline hashes</div>
                <EntityKeyValueGrid
                  items={[
                    { key: "input_hash", label: "Input hash", value: certificate?.input_hash ? shortHash(certificate.input_hash) : "—", mono: true },
                    { key: "pipeline_hash", label: "Pipeline hash", value: certificate?.pipeline_hash ? shortHash(certificate.pipeline_hash) : "—", mono: true },
                    { key: "params_hash", label: "Params hash", value: certificate?.params_hash ? shortHash(certificate.params_hash) : "—", mono: true },
                    { key: "service_hash", label: "Service hash", value: certificate?.service_hash ? shortHash(certificate.service_hash) : "—", mono: true },
                    { key: "source", label: "Source", value: source || "—" },
                  ]}
                />
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Certificate subject"
            description="The subject fields used to identify what this certificate refers to."
          >
            <JsonBlock value={subject} emptyLabel="No visible subject fields" />
          </EntitySection>

          <EntitySection
            title="Compact certificate metadata"
            description="Compact certificate-facing metadata stored on the row."
          >
            <JsonBlock value={compactCertificate} emptyLabel="No compact certificate metadata" />
          </EntitySection>

          <EntitySection
            title="Metadata"
            description="Visible metadata and attributes for deeper review."
          >
            <div className="grid gap-6 xl:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-semibold text-foreground/90">Metadata</div>
                <JsonBlock value={metadata} emptyLabel="No metadata" />
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold text-foreground/90">Attributes</div>
                <JsonBlock value={attributes} emptyLabel="No attributes" />
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Anchors"
            description="Anchor payload visible from the current actor scope."
          >
            <JsonBlock value={certificate?.anchors} emptyLabel="No visible anchors" />
          </EntitySection>
        </>
      )}
    </div>
  );
}