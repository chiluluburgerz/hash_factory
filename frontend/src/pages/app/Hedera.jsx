import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  LockKeyhole,
  KeyRound,
  RefreshCw,
  ScrollText,
  Wallet,
  Waypoints,
  Radio,
  Coins,
  ShieldCheck,
  Search,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import {
  HederaMetricCard,
  HederaWorkspaceCard,
  HederaTrustStep,
  HederaActionLink,
  HederaRecentEmpty,
} from "@/components/hedera/hedera-overview-ui.jsx";
import {
  shortValue,
  formatDateTime,
  formatRelative,
  topicNameOf,
  topicIdOf,
  topicScopeOf,
  topicPurposeOf,
  topicLatestAtOf,
  topicDetailPath,
  walletHasAnchor,
  hcsTopicNameOf,
  hcsMessageIdOf,
  hcsTransactionIdOf,
  hcsCreatedAtOf,
  hcsStatusOf,
  hcsMirrorVerified,
  htsTypeOf,
  htsTokenIdOf,
  htsTransactionIdOf,
  htsAccountIdOf,
  htsCreatedAtOf,
  htsMirrorVerified,
  hcsBestDetailPath,
  htsDetailPath,
  hederaDecryptPath,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function shortWallet(wallet) {
  const addr =
    wallet?.wallet_address ??
    wallet?.address ??
    wallet?.evm_address ??
    "";
  return shortValue(addr, 10, 8);
}

function shortId(value) {
  return shortValue(value, 10, 8);
}

function mirrorPct(verified, total) {
  if (!total) return null;
  const pct = Math.round((verified / total) * 100);
  return `${pct}% mirror verified`;
}

function normalizeOverviewEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  const summary = root?.summary ?? {};
  const recent = root?.recent ?? {};

  return {
    summary: {
      visible_topics: Number(summary?.visible_topics ?? 0) || 0,
      hcs_total: Number(summary?.hcs_total ?? 0) || 0,
      hcs_mirror_verified: Number(summary?.hcs_mirror_verified ?? 0) || 0,
      hts_total: Number(summary?.hts_total ?? 0) || 0,
      hts_mirror_verified: Number(summary?.hts_mirror_verified ?? 0) || 0,
    },
    recent: {
      topics: Array.isArray(recent?.topics) ? recent.topics : [],
      hcs: Array.isArray(recent?.hcs) ? recent.hcs : [],
      hts: Array.isArray(recent?.hts) ? recent.hts : [],
    },
  };
}

// Order must exactly match WORKSPACE_LINKS order for column alignment
const WORKSPACE_LINKS = [
  {
    title: "Topics",
    description: "Visible organization topics and trust-channel primitives.",
    to: "/app/hedera/topics",
    disabled: false,
    status: { variant: "success", label: "Live" },
  },
  {
    title: "HCS Activity",
    description: "Scoped HCS evidence activity and mirror posture.",
    to: "/app/hedera/hcs",
    disabled: false,
    status: { variant: "success", label: "Live" },
  },
  {
    title: "HTS Activity",
    description: "Token-side lifecycle activity for certificates and assets.",
    to: "/app/hedera/hts",
    disabled: false,
    status: { variant: "success", label: "Live" },
  },
  {
    title: "Decrypt & Verify",
    description: "Authorization-aware inspect, verify, and decrypt workflows.",
    to: "/app/hedera/decrypt",
    disabled: false,
    status: { variant: "success", label: "Live" },
  },
  {
    title: "Wallets",
    description: "Identity, primary wallet posture, and trust-linked ownership.",
    to: "/app/wallets",
    disabled: false,
    status: { variant: "success", label: "Live" },
  },
  {
    title: "Certificates",
    description: "Held proof assets, certificate trust, and ownership detail.",
    to: "/app/certificates",
    disabled: false,
    status: { variant: "success", label: "Live" },
  },
];

function RecentTopicList({ rows }) {
  if (!rows.length) {
    return <HederaRecentEmpty label="No recent visible topics were returned for this actor context." />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const topicName = topicNameOf(row);
        const topicId = topicIdOf(row);
        const scope = topicScopeOf(row);
        const purpose = topicPurposeOf(row);
        const latestAt = topicLatestAtOf(row);
        const detailPath = topicDetailPath(row);

        return (
          <div
            key={topicId || `${topicName}-${index}`}
            className="rounded-xl border border-border/60 bg-card/25 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-semibold text-foreground/90">{topicName}</div>
                <div className="text-sm text-muted-foreground">{purpose}</div>
                <div className="font-mono text-xs text-muted-foreground break-all">
                  {topicId || "Topic id unavailable"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{scope}</Badge>
                <Badge variant="outline">
                  {latestAt ? formatRelative(latestAt) : "No recent timestamp"}
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {detailPath ? (
                <HederaActionLink to={detailPath}>Topic detail</HederaActionLink>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="pt-1">
        <Link
          to="/app/hedera/topics"
          className="text-sm font-medium text-foreground/90 underline underline-offset-4"
        >
          Open Topics workspace
        </Link>
      </div>
    </div>
  );
}

function RecentHcsList({ rows }) {
  if (!rows.length) {
    return <HederaRecentEmpty label="No recent HCS activity is currently visible for this actor." />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const topicName = hcsTopicNameOf(row);
        const messageId = hcsMessageIdOf(row);
        const transactionId = hcsTransactionIdOf(row);
        const createdAt = hcsCreatedAtOf(row);
        const mirrorVerified = hcsMirrorVerified(row);
        const detailPath = hcsBestDetailPath(row);
        const decryptPath = messageId
          ? hederaDecryptPath({ messageId, mode: "decrypt_and_verify" })
          : transactionId
          ? hederaDecryptPath({ transactionId, mode: "decrypt_and_verify" })
          : "";

        return (
          <div
            key={messageId || transactionId || `${topicName}-${index}`}
            className="rounded-xl border border-border/60 bg-card/25 p-4"
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground/90">{topicName}</div>
                  <div className="text-xs text-muted-foreground">
                    HCS message {messageId ? shortId(messageId) : "unavailable"}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground break-all">
                    tx {transactionId || "Unavailable"}
                  </div>
                </div>
                <MirrorStatusPill
                  hasAnchor={Boolean(messageId || transactionId)}
                  mirrorVerified={mirrorVerified}
                  size="sm"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{hcsStatusOf(row)}</Badge>
                <span>{createdAt ? formatRelative(createdAt) : "No timestamp"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {detailPath ? (
                  <HederaActionLink to={detailPath}>HCS detail</HederaActionLink>
                ) : null}
                {decryptPath ? (
                  <HederaActionLink to={decryptPath}>Decrypt & verify</HederaActionLink>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      <div className="pt-1">
        <Link
          to="/app/hedera/hcs"
          className="text-sm font-medium text-foreground/90 underline underline-offset-4"
        >
          Open HCS workspace
        </Link>
      </div>
    </div>
  );
}

function RecentHtsList({ rows }) {
  if (!rows.length) {
    return <HederaRecentEmpty label="No recent HTS activity is currently visible for this actor." />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const type = htsTypeOf(row);
        const tokenId = htsTokenIdOf(row);
        const txId = htsTransactionIdOf(row);
        const accountId = htsAccountIdOf(row);
        const createdAt = htsCreatedAtOf(row);
        const mirrorVerified = htsMirrorVerified(row);

        return (
          <div
            key={txId || `${type}-${tokenId || "token"}-${index}`}
            className="rounded-xl border border-border/60 bg-card/25 p-4"
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold capitalize text-foreground/90">{type}</div>
                  <div className="text-xs text-muted-foreground">
                    Token {tokenId || "Unavailable"}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground break-all">
                    {accountId
                      ? `Account ${accountId}`
                      : txId
                      ? `tx ${txId}`
                      : "No account or transaction id"}
                  </div>
                </div>
                <MirrorStatusPill
                  hasAnchor={Boolean(txId)}
                  mirrorVerified={mirrorVerified}
                  size="sm"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{type}</Badge>
                <span>{createdAt ? formatRelative(createdAt) : "No timestamp"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {txId ? (
                  <HederaActionLink to={htsDetailPath(txId)}>HTS detail</HederaActionLink>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      <div className="pt-1">
        <Link
          to="/app/hedera/hts"
          className="text-sm font-medium text-foreground/90 underline underline-offset-4"
        >
          Open HTS workspace
        </Link>
      </div>
    </div>
  );
}

export default function HederaOverviewPage() {
  const {
    isLoading: appLoading,
    org,
    membership,
    entitlements,
    wallets,
    primaryWallet,
    refreshAppContext,
  } = useAppContext();

  const [overview, setOverview] = React.useState({
    summary: {
      visible_topics: 0,
      hcs_total: 0,
      hcs_mirror_verified: 0,
      hts_total: 0,
      hts_mirror_verified: 0,
    },
    recent: { topics: [], hcs: [], hts: [] },
  });

  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const loadPage = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");
    try {
      const payload = await fetchJsonOrThrow("/v1/hedera/overview?recentLimit=5");
      setOverview(normalizeOverviewEnvelope(payload));
    } catch (err) {
      setOverview({
        summary: {
          visible_topics: 0,
          hcs_total: 0,
          hcs_mirror_verified: 0,
          hts_total: 0,
          hts_mirror_verified: 0,
        },
        recent: { topics: [], hcs: [], hts: [] },
      });
      setPageError(err?.message || "Failed to load Hedera overview.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const summary = overview.summary;
  const recent = overview.recent;

  const walletCount = Number(wallets?.length ?? 0);
  const hasPrimaryWallet = Boolean(primaryWallet);
  const visibleTopicCount = Number(summary?.visible_topics ?? 0);
  const hcsTotal = Number(summary?.hcs_total ?? 0);
  const hcsMirrorVerifiedCount = Number(summary?.hcs_mirror_verified ?? 0);
  const htsTotal = Number(summary?.hts_total ?? 0);
  const htsMirrorVerifiedCount = Number(summary?.hts_mirror_verified ?? 0);

  const hasHcsActivity = hcsTotal > 0;
  const hasHtsActivity = htsTotal > 0;
  const mirrorVerifiedSignals = hcsMirrorVerifiedCount + htsMirrorVerifiedCount;
  const walletMirrorVerified = Boolean(primaryWallet?.mirror_verified);
  const walletAnchored = walletHasAnchor(primaryWallet);

  // Trust flow order must mirror WORKSPACE_LINKS order exactly:
  // Topics, HCS Activity, HTS Activity, Decrypt & Verify, Wallets, Certificates
  const trustFlow = React.useMemo(() => {
    return [
      {
        title: "Topics",
        description:
          visibleTopicCount > 0
            ? `${visibleTopicCount} trust channel${visibleTopicCount === 1 ? "" : "s"} visible in this actor context.`
            : "No visible topics returned for this actor context.",
        state: visibleTopicCount > 0 ? "good" : "idle",
      },
      {
        title: "HCS activity",
        description: hasHcsActivity
          ? `${hcsTotal} record${hcsTotal === 1 ? "" : "s"} visible.${mirrorPct(hcsMirrorVerifiedCount, hcsTotal) ? ` ${mirrorPct(hcsMirrorVerifiedCount, hcsTotal)}.` : ""}`
          : "No actor-visible HCS activity yet.",
        state: hasHcsActivity ? "good" : "idle",
      },
      {
        title: "HTS activity",
        description: hasHtsActivity
          ? `${htsTotal} record${htsTotal === 1 ? "" : "s"} visible.${mirrorPct(htsMirrorVerifiedCount, htsTotal) ? ` ${mirrorPct(htsMirrorVerifiedCount, htsTotal)}.` : ""}`
          : "No actor-visible HTS activity yet.",
        state: hasHtsActivity ? "good" : "idle",
      },
      {
        title: "Decrypt & verify",
        description:
          "Authorized users can move from visible HCS records into protected verify and decrypt workflows.",
        state: "good",
      },
      {
        title: "Wallets",
        description: hasPrimaryWallet
          ? walletMirrorVerified
            ? "Primary wallet linked and mirror verified."
            : walletAnchored
            ? "Primary wallet anchored. Mirror confirmation pending."
            : "Primary wallet linked. No anchor signal yet."
          : "No primary wallet linked yet.",
        state: hasPrimaryWallet ? (walletMirrorVerified ? "good" : walletAnchored ? "pending" : "good") : "idle",
      },
      {
        title: "Certificates",
        description:
          mirrorVerifiedSignals > 0
            ? `${mirrorPct(mirrorVerifiedSignals, hcsTotal + htsTotal) ?? mirrorVerifiedSignals + " signal" + (mirrorVerifiedSignals === 1 ? "" : "s")} confirmed. Certificate issuance ${entitlements?.canMintCertificates ? "enabled" : "subject to posture"}.`
            : `Certificate issuance ${entitlements?.canMintCertificates ? "enabled" : "subject to posture"}.`,
        state: entitlements?.canMintCertificates ? "good" : "idle",
      },
    ];
  }, [
    entitlements?.canMintCertificates,
    hasHcsActivity,
    hasHtsActivity,
    hasPrimaryWallet,
    hcsTotal,
    hcsMirrorVerifiedCount,
    htsTotal,
    htsMirrorVerifiedCount,
    mirrorVerifiedSignals,
    visibleTopicCount,
    walletAnchored,
    walletMirrorVerified,
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Hedera Workspace
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Authenticated workspace for topic visibility, anchored HCS and HTS activity, mirror posture, and trust-linked navigation across Hash Factory.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refreshAppContext();
              void loadPage();
            }}
          >
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

      {/* Workspace context */}
      <EntitySection
        title="Workspace context"
        description="Authenticated organization, access posture, and linked wallet behind this Hedera surface."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              Organization
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {appLoading ? "Loading..." : org?.name || "No org"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Role: {membership?.role || "—"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Waypoints className="h-3.5 w-3.5" />
              Workspace posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {visibleTopicCount > 0 || hasHcsActivity || hasHtsActivity ? "Active" : "Limited"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {visibleTopicCount} topic{visibleTopicCount === 1 ? "" : "s"} · {hcsTotal} HCS · {htsTotal} HTS
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Primary wallet
            </div>
            <div className="mt-2 font-mono text-sm text-foreground/90">
              {shortWallet(primaryWallet)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {walletCount} wallet{walletCount === 1 ? "" : "s"} linked
            </div>
            <div className="mt-2">
              <MirrorStatusPill
                hasAnchor={walletHasAnchor(primaryWallet)}
                mirrorVerified={Boolean(primaryWallet?.mirror_verified)}
                size="sm"
              />
            </div>
          </div>
        </div>
      </EntitySection>

      {/* 4 metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HederaMetricCard
          icon={Waypoints}
          title="Topics"
          value={isLoading ? "…" : visibleTopicCount.toLocaleString()}
          hint={
            visibleTopicCount > 0
              ? `${visibleTopicCount} trust channel${visibleTopicCount === 1 ? "" : "s"} visible.`
              : "No visible topics returned for this actor context."
          }
        />
        <HederaMetricCard
          icon={Radio}
          title="HCS transactions"
          value={isLoading ? "…" : hcsTotal.toLocaleString()}
          hint={mirrorPct(hcsMirrorVerifiedCount, hcsTotal) ?? "No mirror-verified HCS records yet."}
        />
        <HederaMetricCard
          icon={Coins}
          title="HTS transactions"
          value={isLoading ? "…" : htsTotal.toLocaleString()}
          hint={mirrorPct(htsMirrorVerifiedCount, htsTotal) ?? "No mirror-verified HTS records yet."}
        />
        <HederaMetricCard
          icon={Wallet}
          title="Wallets"
          value={isLoading ? "…" : walletCount.toLocaleString()}
          hint={
            hasPrimaryWallet
              ? walletMirrorVerified
                ? "Primary wallet is mirror verified."
                : walletAnchored
                ? "Primary wallet anchored, mirror confirmation pending."
                : "Primary wallet linked. No anchor signal yet."
              : "No primary wallet linked."
          }
        />
      </div>

      {/* Trust flow — aligned to workspace access grid below */}
      <EntitySection
        title="Trust flow"
        description="Current signal health for each workspace area. Columns align with workspace access below."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {trustFlow.map((item) => (
            <HederaTrustStep
              key={item.title}
              title={item.title}
              description={item.description}
              state={item.state}
            />
          ))}
        </div>
      </EntitySection>

      {/* Workspace access — same grid, same order as trust flow above */}
      <EntitySection
        title="Workspace access"
        description="Navigate into each workspace. Order mirrors the trust flow above."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {WORKSPACE_LINKS.map((item) => (
            <HederaWorkspaceCard
              key={item.title}
              title={item.title}
              description={item.description}
              to={item.to}
              disabled={item.disabled}
              status={item.status}
            />
          ))}
        </div>
      </EntitySection>

      {/* Recent activity */}
      <EntitySection
        title="Recent activity"
        description="The most recent topic, HCS, and HTS signals visible to the authenticated actor."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Recent topics</CardTitle>
              <CardDescription>Visible trust channels available for drilldown.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecentTopicList rows={recent?.topics || []} />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Recent HCS activity</CardTitle>
              <CardDescription>Anchored message activity and mirror posture for this actor.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecentHcsList rows={recent?.hcs || []} />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Recent HTS activity</CardTitle>
              <CardDescription>Token-side lifecycle records visible to this actor.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecentHtsList rows={recent?.hts || []} />
            </CardContent>
          </Card>
        </div>
      </EntitySection>

      {/* Wallet posture */}
      <EntitySection
        title="Wallet posture"
        description="Identity-side trust posture for the authenticated user's primary wallet."
      >
        <div className="rounded-2xl border border-border/60 bg-card/25 p-4 max-w-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            Primary wallet
          </div>
          <div className="mt-2 font-mono text-sm text-foreground/90">
            {shortWallet(primaryWallet)}
          </div>
          <div className="mt-2">
            <MirrorStatusPill
              hasAnchor={walletHasAnchor(primaryWallet)}
              mirrorVerified={Boolean(primaryWallet?.mirror_verified)}
            />
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            Updated {formatDateTime(primaryWallet?.updated_at || primaryWallet?.created_at)}
          </div>
          <div className="mt-3">
            <Link
              to="/app/wallets"
              className="text-sm font-medium text-foreground/90 underline underline-offset-4"
            >
              Open Wallets
            </Link>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}