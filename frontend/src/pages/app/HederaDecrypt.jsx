import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import CopyIconButton from "@/components/base/copy-icon-button";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import { HederaActionLink } from "@/components/hedera/hedera-overview-ui.jsx";
import {
  formatDateTime,
  formatRelative,
  hcsTopicNameOf,
  hcsMessageIdOf,
  hcsTransactionIdOf,
  hcsCreatedAtOf,
  hcsStatusOf,
  hcsMirrorVerified,
  hcsDetailPath,
  topicDetailPath,
  safeJsonStringify,
  firstDefined,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

const RE_TOPIC_ID = /^\d+\.\d+\.\d+$/;
const RE_INTEGER = /^\d+$/;
const RE_TX_ID_CANONICAL = /^\d+\.\d+\.\d+@\d+\.\d+$/;
const RE_TX_ID_DASHED = /^(\d+\.\d+\.\d+)@(\d+)-(\d+)$/;

function normalizeObjectEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return root && typeof root === "object" && !Array.isArray(root) ? root : {};
}

function topicIdOf(row) {
  return row?.topic_id || row?.hedera_topic_id || row?.id || null;
}

function sequenceNumberOf(row) {
  const n = Number(
    firstDefined(row?.sequence_number, row?.sequenceNumber, row?.message_sequence_number)
  );
  return Number.isFinite(n) ? n : null;
}

function boolish(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

function firstTruthyObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return null;
}

function resolvedVerifyState(result) {
  const candidates = [
    result?.verified,
    result?.is_verified,
    result?.verify_ok,
    result?.ok,
    result?.hash_match,
    result?.matches,
    result?.integrity_ok,
    result?.verification?.verified,
    result?.verification?.hash_match,
    result?.verification?.ok,
  ];

  for (const candidate of candidates) {
    const parsed = boolish(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
}

function resolvedDecryptedPayload(result) {
  return firstTruthyObject(
    result?.decrypted,
    result?.decrypted_payload,
    result?.plaintext,
    result?.cleartext,
    result?.payload_json,
    result?.payload
  ) ?? firstDefined(
    result?.decrypted,
    result?.decrypted_payload,
    result?.plaintext,
    result?.cleartext,
    result?.payload_json,
    result?.payload
  );
}

function resolvedRequestId(err) {
  return (
    err?.requestId ||
    err?.payload?.request_id ||
    err?.payload?.requestId ||
    err?.payload?.detail?.request_id ||
    err?.payload?.detail?.requestId ||
    err?.detail?.requestId ||
    err?.detail?.request_id ||
    null
  );
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const s = String(value || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksLikeMessageId(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  const parts = raw.split("@");
  if (parts.length !== 2) return false;

  const [left, right] = parts;

  const leftIsTopic = RE_TOPIC_ID.test(left);
  const rightIsTopic = RE_TOPIC_ID.test(right);
  const leftIsSeq = RE_INTEGER.test(left);
  const rightIsSeq = RE_INTEGER.test(right);

  return (leftIsTopic && rightIsSeq) || (leftIsSeq && rightIsTopic);
}

function looksLikeTransactionId(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return RE_TX_ID_CANONICAL.test(raw) || RE_TX_ID_DASHED.test(raw);
}

function normalizeMessageId(value) {
  const candidates = buildMessageIdCandidates(value);
  for (const candidate of candidates) {
    if (looksLikeMessageId(candidate)) return candidate;
  }
  return "";
}

function normalizeTransactionId(value) {
  const candidates = buildTransactionIdCandidates(value);
  for (const candidate of candidates) {
    if (looksLikeTransactionId(candidate)) return candidate;
  }
  return "";
}

function getIdentifierValidationError(identifierType, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (identifierType === "transaction_id") {
    return looksLikeTransactionId(raw) ? "" : "The current value is not a transaction id.";
  }
  return looksLikeMessageId(raw) ? "" : "The current value is not a message id.";
}

function buildMessageIdCandidates(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];

  const parts = raw.split("@");
  if (parts.length !== 2) return [raw];

  const [left, right] = parts;

  const leftIsTopic = RE_TOPIC_ID.test(left);
  const rightIsTopic = RE_TOPIC_ID.test(right);
  const leftIsSeq = RE_INTEGER.test(left);
  const rightIsSeq = RE_INTEGER.test(right);

  if (leftIsTopic && rightIsSeq) {
    return uniqueStrings([raw, `${right}@${left}`]);
  }

  if (leftIsSeq && rightIsTopic) {
    return uniqueStrings([raw, `${right}@${left}`]);
  }

  return [raw];
}

function buildTransactionIdCandidates(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];

  const candidates = [raw];

  if (RE_TX_ID_CANONICAL.test(raw)) {
    return candidates;
  }

  const dashedMatch = raw.match(RE_TX_ID_DASHED);
  if (dashedMatch) {
    candidates.push(`${dashedMatch[1]}@${dashedMatch[2]}.${dashedMatch[3]}`);
  }

  const atIndex = raw.indexOf("@");
  if (atIndex > -1) {
    const prefix = raw.slice(0, atIndex + 1);
    const suffix = raw.slice(atIndex + 1);
    const dotVariant = suffix.replace("-", ".");
    if (dotVariant !== suffix) {
      candidates.push(`${prefix}${dotVariant}`);
    }
  }

  return uniqueStrings(candidates);
}

function buildIdentifierCandidates(identifierType, identifierValue) {
  const raw = String(identifierValue || "").trim();
  if (!raw) return [];
  if (identifierType === "transaction_id") {
    if (!looksLikeTransactionId(raw)) return [];
    return buildTransactionIdCandidates(identifierValue);
  }
  if (!looksLikeMessageId(raw)) return [];
  return buildMessageIdCandidates(identifierValue);
}

function buildDecryptPayload({ identifierType, identifierValue, mode, includeDecrypted }) {
  const normalized = String(identifierValue || "").trim();
  if (!normalized) return null;

  const out = { mode };

  if (identifierType === "transaction_id") {
    out.transaction_id = normalized;
  } else {
    out.message_id = normalized;
  }

  if (mode === "verify_only") {
    out.include_decrypted = false;
  } else {
    out.include_decrypted = Boolean(includeDecrypted);
  }

  return out;
}

function deriveActionPath(mode) {
  if (mode === "verify_only") return "/v1/hedera/verify";
  if (mode === "decrypt_only") return "/v1/hedera/decrypt";
  return "/v1/hedera/decrypt/verify";
}

function deriveActionLabel(mode) {
  if (mode === "verify_only") return "Run verify";
  if (mode === "decrypt_only") return "Run decrypt";
  return "Run decrypt & verify";
}

function shouldTryNextCandidate(err) {
  const status = Number(err?.status || 0);
  const message = String(err?.message || "").trim().toLowerCase();
  const code = String(
    err?.payload?.code ||
      err?.payload?.error ||
      err?.payload?.detail?.code ||
      err?.code ||
      ""
  ).trim().toLowerCase();

  if (status === 404) return true;
  if (message === "not_found") return true;
  if (message.includes("not found")) return true;
  if (code === "not_found") return true;
  if (code === "invalid_transaction_id") return true;
  if (code === "invalid_message_id") return true;
  if (message.includes("invalid transaction id")) return true;
  if (message.includes("invalid message id")) return true;

  return false;
}

async function tryIdentifierCandidates(candidates, fn) {
  let lastErr = null;

  for (const candidate of candidates) {
    try {
      const value = await fn(candidate);
      return { ok: true, candidate, value };
    } catch (err) {
      lastErr = err;
      if (!shouldTryNextCandidate(err)) {
        throw err;
      }
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No identifier candidates were available.");
}

function Field({ label, value, mono = false, copyValue = null }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/25 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className={mono ? "font-mono text-xs break-all text-foreground/90" : "text-sm text-foreground/90"}>
          {value || "—"}
        </div>

        {copyValue ? (
          <CopyIconButton
            text={String(copyValue)}
            label={`Copy ${label}`}
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
          />
        ) : null}
      </div>
    </div>
  );
}

export default function HederaDecryptPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const initialMessageId = React.useMemo(
    () => String(searchParams.get("message_id") || "").trim(),
    [searchParams]
  );
  const initialTransactionId = React.useMemo(
    () => String(searchParams.get("transaction_id") || "").trim(),
    [searchParams]
  );
  const initialMode = React.useMemo(() => {
    const raw = String(searchParams.get("mode") || "").trim();
    if (raw === "verify_only" || raw === "decrypt_only" || raw === "decrypt_and_verify") {
      return raw;
    }
    return "decrypt_and_verify";
  }, [searchParams]);

  const [identifierType, setIdentifierType] = React.useState(
    initialMessageId ? "message_id" : initialTransactionId ? "transaction_id" : "message_id"
  );
  const [identifierValue, setIdentifierValue] = React.useState(
    initialMessageId || initialTransactionId || ""
  );
  const [mode, setMode] = React.useState(initialMode);
  const [includeDecrypted, setIncludeDecrypted] = React.useState(initialMode !== "verify_only");

  const [contextDetail, setContextDetail] = React.useState({});
  const [contextLoading, setContextLoading] = React.useState(false);
  const [contextError, setContextError] = React.useState("");

  const [result, setResult] = React.useState(null);
  const [resultError, setResultError] = React.useState("");
  const [resultRequestId, setResultRequestId] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    setIdentifierType(
      initialMessageId ? "message_id" : initialTransactionId ? "transaction_id" : "message_id"
    );
    setIdentifierValue(initialMessageId || initialTransactionId || "");
    setMode(initialMode);
    setIncludeDecrypted(initialMode !== "verify_only");
  }, [initialMessageId, initialTransactionId, initialMode]);

  React.useEffect(() => {
    if (mode === "verify_only") {
      setIncludeDecrypted(false);
    }
  }, [mode]);

  const switchIdentifierType = React.useCallback(
    (nextType) => {
      const raw = String(identifierValue || "").trim();

      if (nextType === identifierType) return;

      if (nextType === "transaction_id") {
        const nextValue =
          String(hcsTransactionIdOf(contextDetail) || "").trim() ||
          normalizeTransactionId(raw) ||
          "";

        setIdentifierType("transaction_id");
        setIdentifierValue(nextValue);
        return;
      }

      const nextValue =
        String(hcsMessageIdOf(contextDetail) || "").trim() ||
        normalizeMessageId(raw) ||
        "";

      setIdentifierType("message_id");
      setIdentifierValue(nextValue);
    },
    [identifierType, identifierValue, contextDetail]
  );

  const identifierValidationError = React.useMemo(
    () => getIdentifierValidationError(identifierType, identifierValue),
    [identifierType, identifierValue]
  );

  const syncSearchParams = React.useCallback(
    (next) => {
      const sp = new URLSearchParams();
      if (next.identifierType === "transaction_id") {
        if (next.identifierValue) sp.set("transaction_id", next.identifierValue);
      } else {
        if (next.identifierValue) sp.set("message_id", next.identifierValue);
      }

      if (
        next.mode === "verify_only" ||
        next.mode === "decrypt_only" ||
        next.mode === "decrypt_and_verify"
      ) {
        sp.set("mode", next.mode);
      }

      setSearchParams(sp, { replace: true });
    },
    [setSearchParams]
  );

  const loadContext = React.useCallback(async () => {
    const raw = String(identifierValue || "").trim();
    const candidates = buildIdentifierCandidates(identifierType, raw);

    if (!candidates.length) {
      setContextDetail({});
      setContextError("");
      setContextLoading(false);
      return;
    }

    setContextLoading(true);
    setContextError("");

    try {
      const attempt = await tryIdentifierCandidates(candidates, async (candidate) => {
        const path =
          identifierType === "transaction_id"
            ? `/v1/hedera/hcs/transactions/${encodeURIComponent(candidate)}`
            : `/v1/hedera/hcs/messages/${encodeURIComponent(candidate)}`;

        const payload = await fetchJsonOrThrow(path);
        return normalizeObjectEnvelope(payload);
      });

      setContextDetail(attempt.value);
    } catch (err) {
      setContextDetail({});
      setContextError(err?.message || "Failed to load HCS context.");
    } finally {
      setContextLoading(false);
    }
  }, [identifierType, identifierValue]);

  React.useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const handleRefresh = React.useCallback(() => {
    void refreshAppContext();
    void loadContext();
  }, [refreshAppContext, loadContext]);

  const handleRun = React.useCallback(async () => {
    const raw = String(identifierValue || "").trim();
    const candidates = buildIdentifierCandidates(identifierType, raw);

    if (!candidates.length) {
      setResult(null);
      setResultRequestId("");
      setResultError("Provide a message id or transaction id before running the workflow.");
      return;
    }

    setIsSubmitting(true);
    setResult(null);
    setResultError("");
    setResultRequestId("");

    try {
      syncSearchParams({
        identifierType,
        identifierValue: raw,
        mode,
      });

      const attempt = await tryIdentifierCandidates(candidates, async (candidate) => {
        const payload = buildDecryptPayload({
          identifierType,
          identifierValue: candidate,
          mode,
          includeDecrypted,
        });

        const response = await fetchJsonOrThrow(deriveActionPath(mode), {
          method: "POST",
          body: payload,
        });

        return normalizeObjectEnvelope(response);
      });

      setResult(attempt.value);
    } catch (err) {
      setResult(null);
      setResultError(err?.message || "Failed to run decrypt and verify workflow.");
      setResultRequestId(resolvedRequestId(err) || "");
    } finally {
      setIsSubmitting(false);
    }
  }, [identifierType, identifierValue, mode, includeDecrypted, syncSearchParams]);

  const messageCandidates = React.useMemo(
    () => (identifierType === "message_id" ? buildMessageIdCandidates(identifierValue) : []),
    [identifierType, identifierValue]
  );

  const transactionCandidates = React.useMemo(
    () => (identifierType === "transaction_id" ? buildTransactionIdCandidates(identifierValue) : []),
    [identifierType, identifierValue]
  );

  const contextMessageId =
    hcsMessageIdOf(contextDetail) || (identifierType === "message_id" ? firstDefined(...messageCandidates) : null);

  const contextTransactionId =
    hcsTransactionIdOf(contextDetail) || (identifierType === "transaction_id" ? firstDefined(...transactionCandidates) : null);

  const contextRecordId = contextMessageId || contextTransactionId || null;
  const contextTopicName = hcsTopicNameOf(contextDetail, "HCS record");
  const contextTopicId = topicIdOf(contextDetail);
  const contextObservedAt = hcsCreatedAtOf(contextDetail);
  const contextStatus = hcsStatusOf(contextDetail);
  const contextMirrorVerified = hcsMirrorVerified(contextDetail);
  const contextSequence = sequenceNumberOf(contextDetail);

  const verifyState = resolvedVerifyState(result);
  const decryptedPayload = resolvedDecryptedPayload(result);
  const resultText = safeJsonStringify(result, "");
  const decryptedText = safeJsonStringify(decryptedPayload, "");
  const resultRecordId = firstDefined(
    result?.message_id,
    result?.record?.message_id,
    result?.tx?.message_id,
    result?.transaction_id,
    result?.record?.transaction_id,
    result?.tx?.transaction_id
  );

  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link to="/app/hedera" className="hover:text-foreground/80">
              Hedera
            </Link>
            <span>/</span>
            <span>Decrypt &amp; Verify</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Decrypt &amp; Verify
          </h1>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Inspect a protected HCS record, verify anchored integrity, and decrypt payload data when
            your actor has access to the underlying trust channel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={contextRecordId ? hcsDetailPath(contextRecordId) : "/app/hedera/hcs"}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
          >
            <ArrowLeft className="h-4 w-4" />
            {contextRecordId ? "Back to HCS detail" : "Back to Hedera HCS"}
          </Link>

          <Button type="button" variant="outline" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {contextError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {contextError}
        </div>
      ) : null}

      {resultError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <div>{resultError}</div>
          {resultRequestId ? (
            <div className="mt-2 font-mono text-xs text-red-100/80">
              request id: {resultRequestId}
            </div>
          ) : null}
        </div>
      ) : null}

      <EntitySection
        title="Current workspace context"
        description="The authenticated organization and current Hedera protected-read posture behind this workflow."
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
              <LockKeyhole className="h-3.5 w-3.5" />
              Protected read posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {identifierValue ? "Targeted" : "Awaiting selection"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {identifierValue
                ? "This workflow is pointed at one HCS record or transaction."
                : "Select a record from the Hedera workspace or paste an id below."}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Actor posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isTenantAdmin ? "Tenant admin" : "User read"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Core remains the source of truth for visibility, topic membership, and decrypt authorization.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={identifierValue ? "success" : "warn"}>
            target {identifierValue ? "selected" : "missing"}
          </Badge>
          <Badge variant={mode === "verify_only" ? "info" : mode === "decrypt_only" ? "warn" : "success"}>
            mode {mode}
          </Badge>
          <Badge variant={includeDecrypted ? "success" : "outline"}>
            decrypted payload {includeDecrypted ? "requested" : "not requested"}
          </Badge>
          <Badge variant={isTenantAdmin ? "info" : "outline"}>
            actor posture {isTenantAdmin ? "admin-capable" : "read-focused"}
          </Badge>
        </div>
      </EntitySection>

      <div className="grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">Run protected verification workflow</CardTitle>
            <CardDescription>
              Provide exactly one message id or transaction id, choose the workflow mode, and run the actor-scoped Hedera inspection flow.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-3 text-sm text-foreground/90">
                <input
                  type="radio"
                  name="identifierType"
                  checked={identifierType === "message_id"}
                  onChange={() => switchIdentifierType("message_id")}
                />
                <span>Message id</span>
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-3 text-sm text-foreground/90">
                <input
                  type="radio"
                  name="identifierType"
                  checked={identifierType === "transaction_id"}
                  onChange={() => switchIdentifierType("transaction_id")}
                />
                <span>Transaction id</span>
              </label>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {identifierType === "transaction_id" ? "Transaction id" : "Message id"}
              </div>
              <Input
                value={identifierValue}
                onChange={(e) => setIdentifierValue(e.target.value)}
                placeholder={
                  identifierType === "transaction_id"
                    ? "Paste a Hedera transaction id"
                    : "Paste a HCS message id"
                }
              />
              {identifierValidationError ? (
                <div className="mt-2 text-xs text-amber-300">
                  {identifierValidationError}
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Workflow mode
              </div>

              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="h-10 w-full rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
              >
                <option value="verify_only">Verify only</option>
                <option value="decrypt_only">Decrypt only</option>
                <option value="decrypt_and_verify">Decrypt and verify</option>
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-3 text-sm text-foreground/90">
              <input
                type="checkbox"
                checked={includeDecrypted}
                disabled={mode === "verify_only"}
                onChange={(e) => setIncludeDecrypted(e.target.checked)}
              />
              <span>Include decrypted payload when permitted</span>
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" onClick={() => void handleRun()} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    {deriveActionLabel(mode)}
                  </>
                )}
              </Button>

              {contextRecordId ? (
                <HederaActionLink to={hcsDetailPath(contextRecordId)}>
                  Open HCS detail
                </HederaActionLink>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">Selected record context</CardTitle>
            <CardDescription>
              This mirrors the HCS detail model so decrypt and verify stays anchored to a concrete Hedera record.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {!identifierValue ? (
              <div className="rounded-xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                No identifier is selected yet. The strongest workflow is to enter from an HCS detail page or HCS activity row.
              </div>
            ) : contextLoading ? (
              <div className="rounded-xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                Loading HCS record context...
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <MirrorStatusPill
                    hasAnchor={Boolean(contextMessageId || contextTransactionId)}
                    mirrorVerified={contextMirrorVerified}
                    size="sm"
                  />
                  <Badge variant="outline">{contextStatus || "Unknown status"}</Badge>
                  {contextSequence != null ? (
                    <Badge variant="outline">sequence {contextSequence}</Badge>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Message id"
                    value={contextMessageId || "—"}
                    mono
                    copyValue={contextMessageId || null}
                  />
                  <Field
                    label="Transaction id"
                    value={contextTransactionId || "—"}
                    mono
                    copyValue={contextTransactionId || null}
                  />
                  <Field
                    label="Topic name"
                    value={contextTopicName || "—"}
                  />
                  <Field
                    label="Topic id"
                    value={contextTopicId || "—"}
                    mono
                    copyValue={contextTopicId || null}
                  />
                  <Field
                    label="Observed"
                    value={
                      contextObservedAt
                        ? `${formatDateTime(contextObservedAt, true)} • ${formatRelative(contextObservedAt)}`
                        : "—"
                    }
                  />
                  <Field
                    label="Status"
                    value={contextStatus || "—"}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {contextRecordId ? (
                    <HederaActionLink to={hcsDetailPath(contextRecordId)}>
                      HCS detail
                    </HederaActionLink>
                  ) : null}

                  {contextTopicId || contextTopicName ? (
                    <HederaActionLink to={topicDetailPath(contextDetail)}>
                      Topic detail
                    </HederaActionLink>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Synchronous result"
        description="The current run result returned through the authenticated Hedera trust surface."
      >
        {!result && !isSubmitting ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            No result yet. Run a verify, decrypt, or decrypt-and-verify workflow to inspect the selected HCS record.
          </div>
        ) : (
          <div className="space-y-4">
            {result ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verification
                    </CardDescription>
                    <CardTitle className="text-2xl tracking-tight">
                      {verifyState == null ? "Unknown" : verifyState ? "Verified" : "Failed"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-sm text-muted-foreground">
                      Derived from the returned verify signal when present.
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                      <KeyRound className="h-3.5 w-3.5" />
                      Payload access
                    </CardDescription>
                    <CardTitle className="text-2xl tracking-tight">
                      {decryptedPayload != null ? "Returned" : "Not returned"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-sm text-muted-foreground">
                      Decrypted payload appears only when requested and authorized.
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                      <Radio className="h-3.5 w-3.5" />
                      Record id
                    </CardDescription>
                    <CardTitle className="text-2xl tracking-tight">
                      {String(
                        firstDefined(
                          result?.message_id,
                          result?.record?.message_id,
                          result?.tx?.message_id,
                          result?.transaction_id,
                          result?.record?.transaction_id,
                          result?.tx?.transaction_id,
                          contextMessageId,
                          contextTransactionId,
                          "—"
                        ) || "—"
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-sm text-muted-foreground">
                      Best available message or transaction reference returned by the workflow.
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                      <ScrollText className="h-3.5 w-3.5" />
                      Topic
                    </CardDescription>
                    <CardTitle className="text-2xl tracking-tight">
                      {String(
                        firstDefined(
                          result?.topic_name,
                          result?.record?.topic_name,
                          result?.topic?.name,
                          contextTopicName
                        ) || "—"
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-sm text-muted-foreground">
                      Best available topic association returned in this run.
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {resultRecordId ? (
              <div className="flex flex-wrap gap-2">
                <HederaActionLink to={hcsDetailPath(resultRecordId)}>
                  Open HCS detail
                </HederaActionLink>
              </div>
            ) : null}

            {decryptedPayload != null ? (
              <Card className="border-border/60 bg-card/35 backdrop-blur">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Decrypted payload</CardTitle>
                      <CardDescription>
                        Returned only because this actor was authorized and decrypted output was requested.
                      </CardDescription>
                    </div>

                    {decryptedText ? (
                      <CopyIconButton
                        text={decryptedText}
                        label="Copy decrypted payload"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                      />
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent>
                  <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/25 p-4 text-xs leading-6 text-foreground/90 whitespace-pre-wrap break-all">
                    {decryptedText}
                  </pre>
                </CardContent>
              </Card>
            ) : null}

            {result ? (
              <Card className="border-border/60 bg-card/35 backdrop-blur">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Raw result envelope</CardTitle>
                      <CardDescription>
                        The unmodified response payload from the Hedera protected-read route.
                      </CardDescription>
                    </div>

                    {resultText ? (
                      <CopyIconButton
                        text={resultText}
                        label="Copy raw result"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                      />
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent>
                  <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/25 p-4 text-xs leading-6 text-foreground/90 whitespace-pre-wrap break-all">
                    {resultText || "—"}
                  </pre>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </EntitySection>

      <EntitySection
        title="How this page fits the workspace"
        description="This page is the protected inspection layer of the authenticated Hedera workspace."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Waypoints className="h-4 w-4" />
              Record-first workflow
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The strongest experience is to enter from HCS detail or a visible HCS row so decrypt and verify stay tied to one concrete record.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Authenticated by design
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Hash Factory surfaces the workflow, but Core remains the source of truth for visibility, authorization, and decrypt policy enforcement.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <LockKeyhole className="h-4 w-4" />
              Protected proof inspection
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This is where users move from actor-visible message activity into integrity verification and protected payload inspection.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}