import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import LoadMoreButton from "@/components/base/load-more-button.jsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import HashscanButton from "@/components/hedera/hashscan-button.jsx";
import { HederaActionLink } from "@/components/hedera/hedera-overview-ui.jsx";
import {
  formatDateTime,
  formatRelative,
  topicNameOf,
  topicIdOf,
  topicScopeOf,
  topicPurposeOf,
  topicLatestAtOf,
  topicMessageCountOf,
  scopeBadgeVariant,
  hcsTopicNameOf,
  hcsMessageIdOf,
  hcsTransactionIdOf,
  hcsCreatedAtOf,
  hcsStatusOf,
  hcsMirrorVerified,
  hcsBestDetailPath,
  hederaDecryptPath,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

const PAGE_SIZE = 25;

function normalizeTopicDetailEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return root && typeof root === "object" && !Array.isArray(root) ? root : {};
}

function normalizeTopicMessagesEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  if (Array.isArray(root)) {
    return {
      topic_name: "",
      count: root.length,
      messages: root,
      limit: root.length,
      offset: 0,
    };
  }

  const messages =
    Array.isArray(root?.messages) ? root.messages :
    Array.isArray(root?.rows) ? root.rows :
    Array.isArray(root?.items) ? root.items :
    [];

  const countRaw = root?.count ?? root?.total ?? messages.length ?? 0;
  const limitRaw = root?.limit ?? messages.length ?? PAGE_SIZE;
  const offsetRaw = root?.offset ?? 0;

  return {
    topic_name: String(root?.topic_name ?? root?.topicName ?? ""),
    count: Number(countRaw) || 0,
    messages,
    limit: Number(limitRaw) || messages.length || PAGE_SIZE,
    offset: Number(offsetRaw) || 0,
  };
}

function rowIdentity(row, fallbackIndex = 0) {
  return [
    hcsMessageIdOf(row) || "",
    hcsTransactionIdOf(row) || "",
    hcsCreatedAtOf(row) || "",
    hcsTopicNameOf(row) || "",
    String(fallbackIndex),
  ].join("|");
}

function mergeUniqueRows(existingRows, nextRows) {
  const merged = [...existingRows];
  const seen = new Set(existingRows.map((row, index) => rowIdentity(row, index)));

  for (let i = 0; i < nextRows.length; i += 1) {
    const row = nextRows[i];
    const key = rowIdentity(row, i);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(row);
    }
  }

  return merged;
}

function MessageEmptyState() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-card/35">
        <Radio className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground/90">
        No visible records
      </h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        No actor-visible HCS records are currently available for this topic.
      </p>
    </div>
  );
}

function MessageRow({ row, topicName }) {
  const messageId = hcsMessageIdOf(row);
  const transactionId = hcsTransactionIdOf(row);
  const createdAt = hcsCreatedAtOf(row);
  const status = hcsStatusOf(row);
  const mirrorVerified = hcsMirrorVerified(row);
  const detailPath = hcsBestDetailPath(row);
  const decryptPath = messageId
    ? hederaDecryptPath({ messageId, mode: "decrypt_and_verify" })
    : transactionId
      ? hederaDecryptPath({ transactionId, mode: "decrypt_and_verify" })
      : "";
  const resolvedTopicName = hcsTopicNameOf(row, topicName);

  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-foreground/90">
                  {resolvedTopicName}
                </div>
                <Badge variant="outline">{status}</Badge>
              </div>

              <div className="text-sm text-muted-foreground">
                Visible HCS record activity for this trust channel.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Message id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {messageId || "Unavailable"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Transaction id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {transactionId || "Unavailable"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Observed
                </div>
                <div className="mt-1 text-sm text-foreground/90">
                  {createdAt ? formatRelative(createdAt) : "No timestamp"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(createdAt)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            <MirrorStatusPill
              hasAnchor={Boolean(messageId || transactionId)}
              mirrorVerified={mirrorVerified}
              size="sm"
            />

            {transactionId ? (
              <HashscanButton
                id={transactionId}
                label="HashScan"
                size="sm"
                title="Open transaction in HashScan"
              />
            ) : null}

            {detailPath ? (
              <HederaActionLink to={detailPath}>
                HCS detail
              </HederaActionLink>
            ) : null}

            {decryptPath ? (
              <HederaActionLink to={decryptPath}>
                Decrypt & verify
              </HederaActionLink>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HederaTopicDetailPage() {
  const { topicName: routeTopicName = "" } = useParams();

  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const [topic, setTopic] = React.useState({});
  const [messagesEnvelope, setMessagesEnvelope] = React.useState({
    topic_name: "",
    count: 0,
    messages: [],
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [pageError, setPageError] = React.useState("");

  const decodedTopicName = React.useMemo(() => {
    try {
      return decodeURIComponent(String(routeTopicName || ""));
    } catch {
      return String(routeTopicName || "");
    }
  }, [routeTopicName]);

  const fetchMessagesPage = React.useCallback(async (offset = 0) => {
    const payload = await fetchJsonOrThrow(
      `/v1/hedera/topics/${encodeURIComponent(decodedTopicName)}/messages?limit=${PAGE_SIZE}&offset=${offset}`
    );
    return normalizeTopicMessagesEnvelope(payload);
  }, [decodedTopicName]);

  const loadPage = React.useCallback(async () => {
    if (!decodedTopicName) {
      setPageError("Topic name is missing.");
      setTopic({});
      setMessagesEnvelope({
        topic_name: "",
        count: 0,
        messages: [],
        limit: PAGE_SIZE,
        offset: 0,
      });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError("");

    try {
      const [topicPayload, messagesPayload] = await Promise.all([
        fetchJsonOrThrow(`/v1/hedera/topics/${encodeURIComponent(decodedTopicName)}`),
        fetchMessagesPage(0),
      ]);

      setTopic(normalizeTopicDetailEnvelope(topicPayload));
      setMessagesEnvelope({
        topic_name: messagesPayload.topic_name,
        count: messagesPayload.count,
        messages: messagesPayload.messages,
        limit: messagesPayload.limit,
        offset: messagesPayload.offset,
      });
    } catch (err) {
      setTopic({});
      setMessagesEnvelope({
        topic_name: "",
        count: 0,
        messages: [],
        limit: PAGE_SIZE,
        offset: 0,
      });
      setPageError(err?.message || "Failed to load Hedera topic detail.");
    } finally {
      setIsLoading(false);
    }
  }, [decodedTopicName, fetchMessagesPage]);

  const loadMore = React.useCallback(async () => {
    if (isLoadingMore) return;

    const currentCount = Array.isArray(messagesEnvelope?.messages)
      ? messagesEnvelope.messages.length
      : 0;
    const totalCount = Number(messagesEnvelope?.count ?? 0) || 0;

    if (currentCount >= totalCount) return;

    setIsLoadingMore(true);
    setPageError("");

    try {
      const nextPage = await fetchMessagesPage(currentCount);

      setMessagesEnvelope((prev) => ({
        topic_name: nextPage.topic_name || prev.topic_name,
        count: Number(nextPage.count ?? prev.count ?? 0) || 0,
        limit: Number(nextPage.limit ?? prev.limit ?? PAGE_SIZE) || PAGE_SIZE,
        offset: Number(nextPage.offset ?? currentCount) || currentCount,
        messages: mergeUniqueRows(
          Array.isArray(prev?.messages) ? prev.messages : [],
          Array.isArray(nextPage?.messages) ? nextPage.messages : []
        ),
      }));
    } catch (err) {
      setPageError(err?.message || "Failed to load additional topic activity.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchMessagesPage, isLoadingMore, messagesEnvelope]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const resolvedTopicName = topicNameOf(topic) || decodedTopicName || "Topic";
  const topicId = topicIdOf(topic);
  const topicScope = topicScopeOf(topic);
  const topicPurpose = topicPurposeOf(topic);
  const topicLatestAt = topicLatestAtOf(topic);
  const messageCountHintRaw = topicMessageCountOf(topic);
  const visibleMessages = Array.isArray(messagesEnvelope?.messages) ? messagesEnvelope.messages : [];
  const totalVisibleMessages = Number(messagesEnvelope?.count ?? visibleMessages.length ?? 0) || 0;
  const loadedMessageCount = visibleMessages.length;
  const hasMoreMessages = loadedMessageCount < totalVisibleMessages;
  const messageCountHint = Number.isFinite(messageCountHintRaw)
    ? messageCountHintRaw
    : totalVisibleMessages;
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  const firstMessage = visibleMessages[0] || null;
  const firstDecryptPath = firstMessage
    ? hcsMessageIdOf(firstMessage)
      ? hederaDecryptPath({
          messageId: hcsMessageIdOf(firstMessage),
          mode: "decrypt_and_verify",
        })
      : hcsTransactionIdOf(firstMessage)
        ? hederaDecryptPath({
            transactionId: hcsTransactionIdOf(firstMessage),
            mode: "decrypt_and_verify",
          })
        : "/app/hedera/decrypt"
    : "/app/hedera/decrypt";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link to="/app/hedera" className="hover:text-foreground/80">
              Hedera
            </Link>
            <span>/</span>
            <Link to="/app/hedera/topics" className="hover:text-foreground/80">
              Topics
            </Link>
            <span>/</span>
            <span className="max-w-[220px] truncate">{resolvedTopicName}</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Topic Detail
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Review this trust channel’s scope, topic metadata, and visible HCS activity history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/hedera/topics"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to topics
          </Link>

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
        title="Topic context"
        description="The trust channel currently visible in this authenticated workspace."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Waypoints className="h-3.5 w-3.5" />
              Topic
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isLoading ? "Loading..." : resolvedTopicName}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Scope: {topicScope}
            </div>
          </div>

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
              <ShieldCheck className="h-3.5 w-3.5" />
              Access posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isTenantAdmin ? "Admin-capable" : "Read-focused"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              This topic is available for authenticated inspection in the current workspace context.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={scopeBadgeVariant(topicScope)}>{topicScope}</Badge>
          <Badge variant={topicId ? "success" : "outline"}>
            topic id {topicId ? "present" : "missing"}
          </Badge>
          <Badge variant={totalVisibleMessages > 0 ? "success" : "outline"}>
            visible messages {totalVisibleMessages}
          </Badge>
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
              Topic scope
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : topicScope}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              The sharing posture of this trust channel.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Radio className="h-3.5 w-3.5" />
              Visible records
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : totalVisibleMessages.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Actor-visible HCS rows available for this topic.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ShieldCheck className="h-3.5 w-3.5" />
              Latest activity
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : topicLatestAt ? formatRelative(topicLatestAt) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Most recent topic-level timestamp currently visible.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Radio className="h-3.5 w-3.5" />
              Activity count
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : Number(messageCountHint || 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Topic message count returned by the current read surface.
            </div>
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Topic summary"
        description="Metadata and the most relevant next actions for this trust channel."
      >
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
              <CardDescription>
                Stable topic detail returned by the authenticated Hedera route.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-card/25 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Topic name
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground/90">
                  {resolvedTopicName}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Purpose
                </div>
                <div className="mt-1 text-sm text-foreground/90">
                  {topicPurpose}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-card/25 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Topic id
                  </div>
                  <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                    {topicId || "Unavailable"}
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-card/25 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Latest activity
                  </div>
                  <div className="mt-1 text-sm text-foreground/90">
                    {topicLatestAt ? formatRelative(topicLatestAt) : "No recent timestamp"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(topicLatestAt)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Next actions</CardTitle>
              <CardDescription>
                Move from this topic into the most relevant investigation and verification workflows.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <HederaActionLink to={`/app/hedera/hcs?topic_name=${encodeURIComponent(resolvedTopicName)}`}>
                  Open HCS activity
                </HederaActionLink>

                <HederaActionLink to={firstDecryptPath}>
                  Decrypt & verify
                </HederaActionLink>
              </div>

              {topicId ? (
                <div className="pt-1">
                  <HashscanButton
                    id={topicId}
                    label="Open in HashScan"
                    size="sm"
                    title="Open topic in HashScan"
                  />
                </div>
              ) : null}

              <div className="rounded-xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                  <ShieldCheck className="h-4 w-4" />
                  Current posture
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {totalVisibleMessages > 0
                    ? `${totalVisibleMessages} visible message${totalVisibleMessages === 1 ? "" : "s"} are currently available for this topic.`
                    : "No actor-visible HCS records are currently available for this topic."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </EntitySection>

      <EntitySection
        title="Topic activity history"
        description="Visible HCS records for this topic in the authenticated actor context."
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading topic activity...
          </div>
        ) : visibleMessages.length === 0 ? (
          <MessageEmptyState />
        ) : (
          <>
            <div className="space-y-4">
              {visibleMessages.map((row, index) => (
                <MessageRow
                  key={rowIdentity(row, index)}
                  row={row}
                  topicName={resolvedTopicName}
                />
              ))}
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <div className="text-sm text-muted-foreground">
                Showing {loadedMessageCount.toLocaleString()} of {totalVisibleMessages.toLocaleString()} visible message{totalVisibleMessages === 1 ? "" : "s"}.
              </div>

              {hasMoreMessages ? (
                <LoadMoreButton
                  onClick={() => {
                    void loadMore();
                  }}
                  loading={isLoadingMore}
                  disabled={isLoading || isLoadingMore}
                  label="Load more activity"
                />
              ) : null}
            </div>
          </>
        )}
      </EntitySection>
    </div>
  );
}