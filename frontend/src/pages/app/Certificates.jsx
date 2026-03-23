import React from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  Search,
  ScrollText,
  ShieldCheck,
  Database,
  Wallet,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Input } from "@/components/base/input";
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

function hasObservedAnchor(row) {
  return Boolean(row?.hcs_transaction_id || row?.hcs_topic_id);
}

function HoldingHeroCard({ config, rows, latest, emptyLabel }) {
  const mintedCount = rows.filter((row) => getCertificateStatus(row) === "minted").length;
  const anchoredCount = rows.filter((row) => hasObservedAnchor(row)).length;

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
              Anchored
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {anchoredCount.toLocaleString()}
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
              {latest?.nft_id && latest?.proof_date ? (
                <Link
                  to={`/app/certificates/${encodeURIComponent(latest.nft_id)}/${encodeURIComponent(
                    toProofDateParam(latest.proof_date)
                  )}`}
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
              <CertificateTrustBadge row={row} />
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
                  to={`/app/certificates/${encodeURIComponent(row.nft_id)}/${encodeURIComponent(
                    toProofDateParam(row.proof_date)
                  )}`}
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
      const latestCertificate = latestPayload ? extractCertificateFromPayload(latestPayload) : null;

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
    };
  }, [visibleRows]);

  const overallCount = visibleRows.length;
  const anchoredCount = visibleRows.filter((row) => hasObservedAnchor(row)).length;
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
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Certificates</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            View the certificate NFTs held by the authenticated user, organized by certificate
            class and surfaced with issuance and anchor-linked signals.
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
          hint="How many of the two core certificate classes are represented in the current view."
          icon={ScrollText}
        />

        <EntitySummaryCard
          title="Minted"
          value={Number(mintedCount).toLocaleString()}
          hint="Certificates with a minted lifecycle state visible on the NFT row."
          icon={ShieldCheck}
        />

        <EntitySummaryCard
          title="Anchored"
          value={Number(anchoredCount).toLocaleString()}
          hint="Certificates with visible HCS linkage on the NFT row."
          icon={Database}
        />
      </div>

      <Card className="border-border/60 bg-card/35 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Filter certificates</CardTitle>
          <CardDescription>
            Search by certificate kind, token id, wallet, NFT id, proof date, transaction id, or
            subject summary.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search certificates"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <HoldingHeroCard
          config={CERTIFICATE_TOKEN_CONFIG.dataset_certificate}
          rows={grouped.datasetRows}
          latest={latestDataset}
          emptyLabel="No dataset certificates are currently visible in this account."
        />

        <HoldingHeroCard
          config={CERTIFICATE_TOKEN_CONFIG.merkle_anchor_certificate}
          rows={grouped.merkleRows}
          latest={latestMerkle}
          emptyLabel="No merkle anchor certificates are currently visible in this account."
        />
      </div>

      <EntitySection
        title="All held certificates"
        description="A complete view of visible certificates in the authenticated tenant context."
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading certificates...
          </div>
        ) : (
          <CertificateHoldingsTable
            rows={sortCertificatesNewestFirst(visibleRows)}
            emptyLabel="No certificates matched the current filter."
          />
        )}
      </EntitySection>
    </div>
  );
}