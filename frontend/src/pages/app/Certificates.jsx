import React from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  Search,
  ScrollText,
  ShieldCheck,
  Database,
  Link2,
  Wallet,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/base/table.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import {
  CERTIFICATE_TOKEN_CONFIG,
  CertificateKindBadge,
  CertificateStatusBadge,
  CertificateTrustBadge,
  CertificateMirrorBadge,
  certificateMatchesQuery,
  normalizeCertificatesEnvelope,
  extractCertificateFromPayload,
  summarizeCertificateSubject,
  getCertificateStatus,
  formatDateTime,
  formatRelative,
  formatDateOnly,
  shortId,
  shortTokenId,
  groupCertificatesByHolding,
  sortCertificatesNewestFirst,
  toProofDateParam,
} from "@/components/certificates/certificate-ui.jsx";

function HoldingHeroCard({
  config,
  rows,
  latest,
  emptyLabel,
}) {
  const mintedCount = rows.filter((row) => getCertificateStatus(row) === "minted").length;
  const verifiedCount = rows.filter((row) => Boolean(row?.mirror_verified)).length;

  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-base">{config.displayName}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Owned
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {rows.length.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Minted
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {mintedCount.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mirror verified
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {verifiedCount.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Token identity
          </div>
          <div className="mt-2 text-sm text-foreground/90">
            <span className="font-semibold">{config.symbol}</span>
            <span className="mx-2 text-muted-foreground">•</span>
            <span className="font-mono">{shortTokenId(config.tokenId)}</span>
          </div>
        </div>

        {!latest ? (
          <div className="rounded-xl border border-border/60 bg-card/25 p-3 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <CertificateKindBadge kind={latest?.certificate_kind} />
              <CertificateStatusBadge status={getCertificateStatus(latest)} />
              <CertificateTrustBadge row={latest} />
            </div>

            <div className="mt-3 text-sm font-semibold text-foreground/90">
              {summarizeCertificateSubject(latest)}
            </div>

            <div className="mt-1 text-xs text-muted-foreground">
              Proof date {formatDateOnly(latest?.proof_date)} • serial{" "}
              {latest?.serial_number ? `#${latest.serial_number}` : "—"} • issued{" "}
              {formatRelative(latest?.minted_at || latest?.created_at)}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CertificateMirrorBadge row={latest} />
                {latest?.nft_id && latest?.proof_date ? (
                  <Link
                    to={`/app/certificates/${encodeURIComponent(latest.nft_id)}/${encodeURIComponent(toProofDateParam(latest.proof_date))}`}
                    className="text-sm font-medium text-foreground/90 underline underline-offset-4"
                  >
                    Open latest certificate
                  </Link>
                ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CertificateHoldingsTable({ rows, emptyLabel }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Certificate</TableHead>
          <TableHead>Trust</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Token</TableHead>
          <TableHead>Issued</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row?.id || `${row?.nft_id}-${toProofDateParam(row?.proof_date)}`}>
            <TableCell className="min-w-[280px]">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground/90">
                  {summarizeCertificateSubject(row)}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  nft {shortId(row?.nft_id)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Proof date {formatDateOnly(row?.proof_date)}
                </div>
              </div>
            </TableCell>

            <TableCell className="min-w-[180px]">
              <div className="flex flex-col gap-2">
                <CertificateTrustBadge row={row} />
                <CertificateMirrorBadge row={row} />
              </div>
            </TableCell>

            <TableCell className="min-w-[120px]">
              <CertificateStatusBadge status={getCertificateStatus(row)} />
            </TableCell>

            <TableCell className="min-w-[160px]">
              <div className="text-sm text-foreground/90">
                {row?.token_id || "—"}
                {row?.serial_number ? ` • #${row.serial_number}` : ""}
              </div>
            </TableCell>

            <TableCell className="min-w-[140px]">
              <div className="text-sm text-foreground/85">
                {formatRelative(row?.minted_at || row?.created_at)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(row?.minted_at || row?.created_at)}
              </div>
            </TableCell>

            <TableCell className="min-w-[160px]">
              {row?.nft_id && row?.proof_date ? (
                <Link
                  to={`/app/certificates/${encodeURIComponent(row.nft_id)}/${encodeURIComponent(toProofDateParam(row.proof_date))}`}
                  className="text-sm font-medium text-foreground/90 underline underline-offset-4"
                >
                  Open detail
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">Unavailable</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function CertificatesPage() {
  const [rows, setRows] = React.useState([]);
  const [latest, setLatest] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [search, setSearch] = React.useState("");

  const loadCertificates = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const [listPayload, latestPayload] = await Promise.all([
        fetchJsonOrThrow("/v1/certificates/me"),
        fetchJsonOrThrow("/v1/certificates/me/latest").catch(() => null),
      ]);

      const normalized = normalizeCertificatesEnvelope(listPayload);
      const latestCertificate = latestPayload
        ? extractCertificateFromPayload(latestPayload)
        : null;

      setRows(Array.isArray(normalized.certificates) ? normalized.certificates : []);
      setLatest(latestCertificate || null);
    } catch (err) {
      setRows([]);
      setLatest(null);
      setPageError(err?.message || "Failed to load certificates.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCertificates();
  }, [loadCertificates]);

  const visibleRows = React.useMemo(() => {
    return rows.filter((row) => certificateMatchesQuery(row, search));
  }, [rows, search]);

  const grouped = React.useMemo(() => {
    const byHolding = groupCertificatesByHolding(visibleRows);

    return {
      datasetRows: sortCertificatesNewestFirst(byHolding.dataset_certificate),
      merkleRows: sortCertificatesNewestFirst(byHolding.merkle_anchor_certificate),
      otherRows: sortCertificatesNewestFirst(byHolding.other),
    };
  }, [visibleRows]);

  const overallCount = visibleRows.length;
  const verifiedCount = visibleRows.filter((row) => Boolean(row?.mirror_verified)).length;
  const mintedCount = visibleRows.filter((row) => getCertificateStatus(row) === "minted").length;
  const tokenClassesHeld = [
    grouped.datasetRows.length > 0 ? "dataset" : null,
    grouped.merkleRows.length > 0 ? "merkle" : null,
  ].filter(Boolean).length;

  const latestDataset = grouped.datasetRows[0] || null;
  const latestMerkle = grouped.merkleRows[0] || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Certificates
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            View the Vera Anchor certificate assets held by the authenticated user, organized by
            certificate token class and backed by proof, anchor, and mirror trust signals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadCertificates()}>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Held certificates"
          value={Number(overallCount).toLocaleString()}
          hint="Total visible certificate NFTs held by this authenticated actor."
          icon={Wallet}
        />
        <EntitySummaryCard
          title="Certificate classes"
          value={Number(tokenClassesHeld).toLocaleString()}
          hint="How many of the two core Vera Anchor certificate token classes are currently held."
          icon={ScrollText}
        />
        <EntitySummaryCard
          title="Minted"
          value={Number(mintedCount).toLocaleString()}
          hint="Certificates with a completed minted lifecycle state."
          icon={ShieldCheck}
        />
        <EntitySummaryCard
          title="Mirror verified"
          value={Number(verifiedCount).toLocaleString()}
          hint="Certificates with confirmed mirror verification."
          icon={Database}
        />
      </div>

      <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search within held certificates by dataset, anchor, nft id, token id, proof date, or hash"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      <EntitySection
        title="Holdings by certificate token"
        description="The two core Vera Anchor certificate assets currently held by the authenticated user."
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading certificate holdings...
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <HoldingHeroCard
              config={CERTIFICATE_TOKEN_CONFIG.dataset_certificate}
              rows={grouped.datasetRows}
              latest={latestDataset}
              emptyLabel="No dataset certificate holdings are currently visible for this user."
            />

            <HoldingHeroCard
              config={CERTIFICATE_TOKEN_CONFIG.merkle_anchor_certificate}
              rows={grouped.merkleRows}
              latest={latestMerkle}
              emptyLabel="No merkle anchor certificate holdings are currently visible for this user."
            />
          </div>
        )}
      </EntitySection>

      <EntitySection
        title="Dataset certificate holdings"
        description={`${CERTIFICATE_TOKEN_CONFIG.dataset_certificate.displayName} • ${CERTIFICATE_TOKEN_CONFIG.dataset_certificate.symbol} • ${CERTIFICATE_TOKEN_CONFIG.dataset_certificate.tokenId}`}
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading dataset certificate holdings...
          </div>
        ) : (
          <CertificateHoldingsTable
            rows={grouped.datasetRows}
            emptyLabel="No dataset certificate holdings matched the current view."
          />
        )}
      </EntitySection>

      <EntitySection
        title="Merkle anchor certificate holdings"
        description={`${CERTIFICATE_TOKEN_CONFIG.merkle_anchor_certificate.displayName} • ${CERTIFICATE_TOKEN_CONFIG.merkle_anchor_certificate.symbol} • ${CERTIFICATE_TOKEN_CONFIG.merkle_anchor_certificate.tokenId}`}
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading merkle anchor certificate holdings...
          </div>
        ) : (
          <CertificateHoldingsTable
            rows={grouped.merkleRows}
            emptyLabel="No merkle anchor certificate holdings matched the current view."
          />
        )}
      </EntitySection>

      {grouped.otherRows.length > 0 ? (
        <EntitySection
          title="Other certificate rows"
          description="Visible certificate rows that do not map to the current two primary Vera Anchor certificate token ids."
        >
          <CertificateHoldingsTable
            rows={grouped.otherRows}
            emptyLabel="No additional certificate rows."
          />
        </EntitySection>
      ) : null}

      <EntitySection
        title="Current posture"
        description="Why this page is structured around holdings rather than generic search."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Wallet className="h-4 w-4" />
              Asset-centered
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Users should first see the certificate assets they actually hold, not be forced into an existence-check workflow.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Link2 className="h-4 w-4" />
              Trust-visible
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Every held certificate row surfaces proof date, serial, anchor visibility, and mirror posture in one place.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Database className="h-4 w-4" />
              Foundation-ready
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This page can later absorb wallet-native token holdings or explorer links without changing the overall product model.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}