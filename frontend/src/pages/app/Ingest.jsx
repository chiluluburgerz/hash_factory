// ============================================================================
// File: src/pages/Ingest.jsx
// Purpose:
//   Ingest entrypoint for Hash Factory.
//   - Direct users into the correct ingest workflow
//   - Show current domain posture without acting like a registry
//   - Support proof lookup for concrete trust inspection
// ============================================================================

import React from "react";
import { Link } from "react-router-dom";
import {
  FlaskConical,
  RefreshCw,
  ShieldCheck,
  Link2,
  ArrowRight,
  Layers3,
  FolderTree,
  ScrollText,
  ListTree,
  Package,
  Search,
  Radio,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import {
  deriveIngestPosture,
  normalizeEnvelope,
  shortHash,
  formatDateTime,
  formatRelative,
  extractApiErrorMessage,
  getRootHash,
  getRootId,
  getRootProofDate,
  getLeafCount,
  getProofLeafHash,
  getProofRootHash,
  getProofAuditPathLength,
  getRootTrustState,
  trustVariant,
  trustLabel,
} from "@/lib/ingestUtils.js";

function IngestTrustBadge({ trust }) {
  return <Badge variant={trustVariant(trust)}>{trustLabel(trust)}</Badge>;
}

function WorkflowCard({
  icon: Icon,
  title,
  description,
  to,
  actionLabel,
  variant = "default",
}) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        <Button asChild variant={variant} className="w-full justify-center">
          <Link to={to}>
            <ArrowRight className="mr-2 h-4 w-4" />
            {actionLabel}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ProofLookupSummary({ proofResult, entityId, proofDate, domain }) {
  if (!proofResult) return null;

  const leafHash = getProofLeafHash(proofResult);
  const rootHash = getProofRootHash(proofResult);
  const auditPathLength = getProofAuditPathLength(proofResult);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <EntityKeyValueGrid
        title="Lookup request"
        items={[
          { key: "entityId", label: "Entity id", value: entityId || "—", mono: true },
          { key: "proofDate", label: "Proof date", value: proofDate || "—" },
          { key: "domain", label: "Domain", value: domain || "—", mono: true },
        ]}
      />

      <EntityKeyValueGrid
        title="Proof summary"
        items={[
          { key: "leafHash", label: "Leaf hash", value: leafHash || "—", mono: true },
          { key: "rootHash", label: "Root hash", value: rootHash || "—", mono: true },
          {
            key: "auditPathLength",
            label: "Audit path length",
            value: auditPathLength != null ? String(auditPathLength) : "—",
          },
        ]}
      />
    </div>
  );
}

export default function IngestPage() {
  const { org, membership, entitlements, resourceErrors } = useAppContext();

  const posture = React.useMemo(
    () => deriveIngestPosture(entitlements, membership),
    [entitlements, membership]
  );

  const ingestDomain = React.useMemo(() => {
    if (!org?.id) return "";
    return `hf:ingest|org:${org.id}`;
  }, [org?.id]);

  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [rootResult, setRootResult] = React.useState(null);
  const [treeResult, setTreeResult] = React.useState(null);
  const [proofResult, setProofResult] = React.useState(null);

  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [proofError, setProofError] = React.useState("");
  const [proofBusy, setProofBusy] = React.useState(false);

  const [rootLoadNote, setRootLoadNote] = React.useState("");
  const [treeLoadNote, setTreeLoadNote] = React.useState("");

  const [proofSearch, setProofSearch] = React.useState({
    entityId: "",
    proofDate: today,
  });

  const topError = pageError || resourceErrors?.ingest?.message || "";

  const loadIngestSurface = React.useCallback(async () => {
    if (!ingestDomain) {
      setRootResult(null);
      setTreeResult(null);
      setRootLoadNote("");
      setTreeLoadNote("");
      setPageError("");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError("");
    setRootLoadNote("");
    setTreeLoadNote("");

    try {
      const rootPayload = await fetchJsonOrThrow(
        `/v1/merkle/root?${new URLSearchParams({ domain: ingestDomain }).toString()}`
      ).catch((err) => {
        setRootLoadNote(extractApiErrorMessage(err, "Root payload unavailable."));
        return null;
      });

      const normalizedRoot = normalizeEnvelope(rootPayload);
      setRootResult(normalizedRoot);

      const resolvedProofDate =
        getRootProofDate(normalizedRoot)?.slice?.(0, 10) || today;

      const treePayload = await fetchJsonOrThrow(
        `/v1/merkle/tree?${new URLSearchParams({
          domain: ingestDomain,
          proofDate: resolvedProofDate,
        }).toString()}`
      ).catch((err) => {
        setTreeLoadNote(
          extractApiErrorMessage(
            err,
            `Tree snapshot unavailable for ${resolvedProofDate}.`
          )
        );
        return null;
      });

      setTreeResult(normalizeEnvelope(treePayload));

      if (!normalizedRoot && !treePayload) {
        setPageError("No current ingest domain state is available.");
      }
    } catch (err) {
      setRootResult(null);
      setTreeResult(null);
      setPageError(extractApiErrorMessage(err, "Failed to load ingest surface."));
    } finally {
      setIsLoading(false);
    }
  }, [ingestDomain, today]);

  React.useEffect(() => {
    void loadIngestSurface();
  }, [loadIngestSurface]);

  async function handleProofLookup() {
    const entityId = String(proofSearch.entityId || "").trim();
    const proofDate = String(proofSearch.proofDate || "").trim();

    if (!entityId) {
      setProofError("Entity id is required for proof lookup.");
      setProofResult(null);
      return;
    }

    if (!ingestDomain) {
      setProofError("No active ingest domain is available for the current org context.");
      setProofResult(null);
      return;
    }

    setProofBusy(true);
    setProofError("");
    setProofResult(null);

    try {
      const qs = new URLSearchParams({
        entityId,
        domain: ingestDomain,
      });

      if (proofDate) {
        qs.set("proofDate", proofDate);
      }

      const payload = await fetchJsonOrThrow(`/v1/merkle/proof?${qs.toString()}`);
      setProofResult(normalizeEnvelope(payload));
    } catch (err) {
      setProofError(extractApiErrorMessage(err, "Failed to load ingest proof."));
      setProofResult(null);
    } finally {
      setProofBusy(false);
    }
  }

  const rootTrust = getRootTrustState(rootResult);
  const rootHash = getRootHash(rootResult);
  const rootId = getRootId(rootResult);
  const rootProofDate = getRootProofDate(rootResult);
  const currentProofDate = rootProofDate?.slice?.(0, 10) || today;
  const leafCount = getLeafCount(treeResult) ?? getLeafCount(rootResult) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Ingest
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Entry point for ingest execution, local-first finalization, verification, and trust inspection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadIngestSurface()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {topError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {topError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Ingest access"
          value={posture.canUseIngest ? "Enabled" : "Restricted"}
          hint="Whether this actor can use ingest workflows."
          icon={FlaskConical}
        />

        <EntitySummaryCard
          title="Register and anchor"
          value={posture.canRegisterAndAnchor ? "Available" : "Limited"}
          hint="Anchored ingest finalization requires elevated tenant posture."
          icon={ShieldCheck}
        />

        <EntitySummaryCard
          title="Current root status"
          value={trustLabel(rootTrust)}
          hint={
            rootHash
              ? `Root ${shortHash(rootHash)}`
              : "No current Merkle root observed for this ingest domain."
          }
          icon={Link2}
        />

        <EntitySummaryCard
          title="Current leaf count"
          value={leafCount != null ? Number(leafCount).toLocaleString() : "—"}
          hint="Leaf count visible from the current domain state."
          icon={Layers3}
        />
      </div>

      <EntitySection
        title="Choose a workflow"
        description="Start in the surface that matches the current task."
      >
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="grid gap-4">
            <WorkflowCard
              icon={ListTree}
              title="Registry"
              description="Review anchored request history, lifecycle state, and request-level linkage."
              to="/app/ingest/requests"
              actionLabel="Open registry"
              variant="outline"
            />

            <WorkflowCard
              icon={Search}
              title="Verify"
              description="Re-check receipts, bundles, or local artifacts without rerunning ingest."
              to="/app/verify"
              actionLabel="Open verify workspace"
              variant="outline"
            />
          </div>

          <div className="grid gap-4">
            <WorkflowCard
              icon={FlaskConical}
              title="Guided ingest anchor"
              description="Use the managed HF path when Hash Factory should compute evidence and run the anchored flow."
              to="/app/ingest/anchor"
              actionLabel="Open guided ingest"
            />

            <WorkflowCard
              icon={Package}
              title="Local-first submit"
              description="Use the local-first path when evidence was computed outside HF and HF should finalize the trust record."
              to="/app/ingest/submit"
              actionLabel="Open local-first submit"
            />
          </div>
        </div>
      </EntitySection>

      <EntitySection
        title="Current domain posture"
        description="Compact read-side state for the active ingest domain."
      >
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Current root state</CardTitle>
              <CardDescription>
                Current Merkle posture for the active ingest domain.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
                  Loading current domain posture...
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={posture.canUseIngest ? "success" : "warn"}>
                      ingest {posture.canUseIngest ? "enabled" : "restricted"}
                    </Badge>
                    <Badge variant={posture.canRegisterAndAnchor ? "success" : "warn"}>
                      register_and_anchor {posture.canRegisterAndAnchor ? "available" : "limited"}
                    </Badge>
                    <IngestTrustBadge trust={rootTrust} />
                  </div>

                  <EntityKeyValueGrid
                    items={[
                      { key: "domain", label: "Domain", value: ingestDomain || "—", mono: true },
                      { key: "rootId", label: "Root id", value: rootId || "—", mono: true },
                      { key: "rootHash", label: "Root hash", value: rootHash || "—", mono: true },
                      {
                        key: "leafCount",
                        label: "Leaf count",
                        value: leafCount != null ? String(leafCount) : "—",
                      },
                      {
                        key: "proofDate",
                        label: "Current proof date",
                        value: rootProofDate
                          ? `${formatDateTime(rootProofDate)} (${formatRelative(rootProofDate)})`
                          : "—",
                      },
                    ]}
                  />

                  {rootLoadNote ? (
                    <div className="rounded-xl border border-border/60 bg-background/30 p-3 text-sm text-muted-foreground">
                      {rootLoadNote}
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Current tree snapshot</CardTitle>
                <CardDescription>
                  Tree payload resolved against the current proof date when available.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <EntityKeyValueGrid
                  items={[
                    {
                      key: "treeProofDate",
                      label: "Tree proof date",
                      value: treeResult?.proof_date || currentProofDate,
                    },
                    {
                      key: "treeLeafCount",
                      label: "Tree leaf count",
                      value: getLeafCount(treeResult) != null ? String(getLeafCount(treeResult)) : "—",
                    },
                    {
                      key: "treeLoaded",
                      label: "Tree payload loaded",
                      value: treeResult ? "true" : "false",
                    },
                    {
                      key: "rootLoaded",
                      label: "Root payload loaded",
                      value: rootResult ? "true" : "false",
                    },
                  ]}
                />

                {treeLoadNote ? (
                  <div className="rounded-xl border border-border/60 bg-background/30 p-3 text-sm text-muted-foreground">
                    {treeLoadNote}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Proof lookup</CardTitle>
                <CardDescription>
                  Load a proof for a concrete entity in the current ingest domain.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Entity id</label>
                    <input
                      type="text"
                      value={proofSearch.entityId}
                      onChange={(e) =>
                        setProofSearch((prev) => ({ ...prev, entityId: e.target.value }))
                      }
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                      placeholder="leaf id, receipt id, or bound entity id"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Proof date</label>
                    <input
                      type="date"
                      value={proofSearch.proofDate}
                      onChange={(e) =>
                        setProofSearch((prev) => ({ ...prev, proofDate: e.target.value }))
                      }
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </div>

                {proofError ? (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                    {proofError}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button type="button" disabled={proofBusy} onClick={() => void handleProofLookup()}>
                    <Search className="mr-2 h-4 w-4" />
                    {proofBusy ? "Loading proof..." : "Load proof"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </EntitySection>

      {proofResult ? (
        <EntitySection
          title="Proof result"
          description="Proof details returned for the current lookup."
        >
          <div className="space-y-4">
            <ProofLookupSummary
              proofResult={proofResult}
              entityId={proofSearch.entityId}
              proofDate={proofSearch.proofDate}
              domain={ingestDomain}
            />

            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Proof response</CardTitle>
                <CardDescription>
                  Raw proof response returned by the trust API.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JsonBlock value={proofResult} emptyLabel="No proof response" />
              </CardContent>
            </Card>
          </div>
        </EntitySection>
      ) : null}
    </div>
  );
}