import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  RefreshCw,
  Search,
  ShieldCheck,
  Waypoints,
  Radio,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { HederaActionLink } from "@/components/hedera/hedera-overview-ui.jsx";
import {
  formatDateTime,
  formatRelative,
  topicNameOf,
  topicIdOf,
  topicScopeOf,
  topicPurposeOf,
  topicLatestAtOf,
  topicDetailPath,
  scopeBadgeVariant,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function normalizeTopicsEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.topics)) return root.topics;
  if (Array.isArray(root?.rows)) return root.rows;
  if (Array.isArray(payload?.topics)) return payload.topics;

  return [];
}

function sortTopics(rows, sortKey) {
  const copy = [...rows];

  copy.sort((a, b) => {
    if (sortKey === "name") {
      return topicNameOf(a).localeCompare(topicNameOf(b));
    }

    if (sortKey === "scope") {
      return topicScopeOf(a).localeCompare(topicScopeOf(b));
    }

    const ams = Date.parse(topicLatestAtOf(a) || "") || 0;
    const bms = Date.parse(topicLatestAtOf(b) || "") || 0;
    return bms - ams;
  });

  return copy;
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-card/35">
        <Waypoints className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground/90">
        No visible topics
      </h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        No Hedera topics are currently visible for this workspace.
      </p>
    </div>
  );
}

function TopicRow({ row }) {
  const topicName = topicNameOf(row);
  const topicId = topicIdOf(row);
  const scope = topicScopeOf(row);
  const purpose = topicPurposeOf(row);
  const latestAt = topicLatestAtOf(row);

  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-foreground/90">
                  {topicName}
                </div>
                <Badge variant={scopeBadgeVariant(scope)}>{scope}</Badge>
              </div>

              <div className="text-sm text-muted-foreground">
                {purpose || "No purpose provided."}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Topic id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {topicId || "Unavailable"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest activity
                </div>
                <div className="mt-1 text-sm text-foreground/90">
                  {latestAt ? formatRelative(latestAt) : "No recent timestamp"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(latestAt)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            <HederaActionLink to={topicDetailPath(row)}>
              Open detail
            </HederaActionLink>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HederaTopicsPage() {
  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const [topics, setTopics] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [scopeFilter, setScopeFilter] = React.useState("all");
  const [sortKey, setSortKey] = React.useState("activity");

  const loadPage = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const payload = await fetchJsonOrThrow("/v1/hedera/topics");
      setTopics(normalizeTopicsEnvelope(payload));
    } catch (err) {
      setTopics([]);
      setPageError(err?.message || "Failed to load Hedera topics.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const filteredTopics = React.useMemo(() => {
    const q = String(query || "").trim().toLowerCase();

    const base = topics.filter((row) => {
      const name = topicNameOf(row).toLowerCase();
      const topicId = String(topicIdOf(row) || "").toLowerCase();
      const purpose = topicPurposeOf(row).toLowerCase();
      const scope = String(topicScopeOf(row) || "").toLowerCase();

      const matchesQuery =
        !q ||
        name.includes(q) ||
        topicId.includes(q) ||
        purpose.includes(q);

      const matchesScope =
        scopeFilter === "all" ? true : scope === scopeFilter;

      return matchesQuery && matchesScope;
    });

    return sortTopics(base, sortKey);
  }, [topics, query, scopeFilter, sortKey]);

  const totalTopics = Number(topics?.length ?? 0) || 0;
  const orgTopics = topics.filter((row) => topicScopeOf(row) === "org").length;
  const sharedTopics = topics.filter((row) => topicScopeOf(row) === "shared").length;
  const globalTopics = topics.filter((row) => topicScopeOf(row) === "global").length;
  const activeWithRecentTimestamp = topics.filter((row) => Boolean(topicLatestAtOf(row))).length;
  const broaderScopeCount = sharedTopics + globalTopics;
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link to="/app/hedera" className="hover:text-foreground/80">
              Hedera
            </Link>
            <span>/</span>
            <span>Topics</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Hedera Topics
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Browse the trust channels visible to this workspace, review their scope and purpose,
            and move into topic-level activity.
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

      <EntitySection
        title="Workspace context"
        description="Visible topic coverage for the current authenticated workspace."
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
              Topic visibility
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {totalTopics > 0 ? "Visible" : "Limited"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {totalTopics.toLocaleString()} accessible topic{totalTopics === 1 ? "" : "s"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Access posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isTenantAdmin ? "Admin-capable" : "Read-focused"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Topic visibility and detail views are scoped to the current actor.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={totalTopics > 0 ? "success" : "warn"}>
            topics {totalTopics > 0 ? "visible" : "not visible"}
          </Badge>
          <Badge variant="outline">org {orgTopics}</Badge>
          <Badge variant={sharedTopics > 0 ? "warn" : "outline"}>shared {sharedTopics}</Badge>
          <Badge variant={globalTopics > 0 ? "info" : "outline"}>global {globalTopics}</Badge>
          <Badge variant={isTenantAdmin ? "info" : "outline"}>
            access {isTenantAdmin ? "admin-capable" : "read-focused"}
          </Badge>
        </div>
      </EntitySection>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Waypoints className="h-3.5 w-3.5" />
              Total topics
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : totalTopics.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Trust channels visible in this workspace.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Radio className="h-3.5 w-3.5" />
              Recent activity
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : activeWithRecentTimestamp.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Topics with a visible activity timestamp.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Building2 className="h-3.5 w-3.5" />
              Org scope
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : orgTopics.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Organization-scoped channels.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ShieldCheck className="h-3.5 w-3.5" />
              Broader scope
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : broaderScopeCount.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Shared and global channels.
            </div>
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Browse topics"
        description="Search, filter, and sort visible channels."
      >
        <div className="grid gap-3 lg:grid-cols-[1.4fr,180px,180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by topic name, purpose, or topic id"
              className="pl-10"
            />
          </div>

          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="all">All scopes</option>
            <option value="org">Org</option>
            <option value="shared">Shared</option>
            <option value="global">Global</option>
          </select>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="activity">Sort by activity</option>
            <option value="name">Sort by name</option>
            <option value="scope">Sort by scope</option>
          </select>
        </div>

        <div className="mt-4 text-sm text-muted-foreground">
          Showing {filteredTopics.length.toLocaleString()} of {totalTopics.toLocaleString()} visible topic{totalTopics === 1 ? "" : "s"}.
        </div>
      </EntitySection>

      <EntitySection
        title="Visible topics"
        description="Each topic represents a trust channel available to this actor."
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading Hedera topics...
          </div>
        ) : filteredTopics.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {filteredTopics.map((row, index) => (
              <TopicRow
                key={topicIdOf(row) || `${topicNameOf(row)}-${index}`}
                row={row}
              />
            ))}
          </div>
        )}
      </EntitySection>
    </div>
  );
}