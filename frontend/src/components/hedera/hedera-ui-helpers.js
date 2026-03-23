import React from "react";

export function shortValue(value, left = 8, right = 6) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function formatDateTime(value, withSeconds = false) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  }).format(new Date(ms));
}

export function formatRelative(value) {
  if (!value) return "—";
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

export function topicNameOf(row) {
  return (
    row?.topic_name ||
    row?.name ||
    row?.canonical_name ||
    row?.key ||
    "Unnamed topic"
  );
}

export function topicRouteKeyOf(row) {
  const raw =
    row?.topic_key ||
    row?.canonical_name ||
    row?.name_key ||
    row?.topic_name_key ||
    row?.topic_name ||
    row?.name ||
    row?.key ||
    null;

  const s = String(raw || "").trim().toLowerCase();
  return /^[a-z0-9_-]{3,64}$/.test(s) ? s : null;
}

export function topicDetailPath(row) {
  const topicName = String(
    row?.topic_name ||
    row?.name ||
    row?.canonical_name ||
    row?.key ||
    ""
  ).trim().toLowerCase();

  if (/^[a-z0-9_-]{3,64}$/.test(topicName)) {
    return `/app/hedera/topics/${encodeURIComponent(topicName)}`;
  }

  const key = topicRouteKeyOf(row);
  return key ? `/app/hedera/topics/${encodeURIComponent(key)}` : "/app/hedera/topics";
}

export function topicIdOf(row) {
  return row?.topic_id || row?.hedera_topic_id || row?.id || null;
}

export function topicScopeOf(row) {
  return row?.scope || row?.topic_scope || "org";
}

export function topicPurposeOf(row) {
  return row?.purpose || row?.description || "Hedera topic";
}

export function topicLatestAtOf(row) {
  return (
    row?.latest_activity_at ||
    row?.last_activity_at ||
    row?.updated_at ||
    row?.created_at ||
    null
  );
}

export function topicMessageCountOf(row) {
  const raw =
    row?.message_count_hint ??
    row?.message_count ??
    row?.visible_message_count ??
    row?.visible_messages ??
    row?.messages_count ??
    row?.count ??
    null;

  if (raw == null || raw === "") return null;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function scopeBadgeVariant(scope) {
  const s = String(scope || "").toLowerCase();
  if (s === "global") return "info";
  if (s === "shared") return "warn";
  return "outline";
}

export function walletHasAnchor(row) {
  return Boolean(row?.hcs_topic_id || row?.hcs_transaction_id || row?.hcs_message_id);
}

export function hcsTopicNameOf(row, fallback = "HCS activity") {
  return row?.topic_name || row?.topic || row?.name || fallback;
}

export function hcsMessageIdOf(row) {
  return row?.message_id || row?.hcs_message_id || null;
}

export function hcsTransactionIdOf(row) {
  return row?.transaction_id || row?.hcs_transaction_id || null;
}

export function hcsCreatedAtOf(row) {
  return (
    row?.consensus_timestamp ||
    row?.created_at ||
    row?.updated_at ||
    row?.valid_start_timestamp ||
    null
  );
}

export function hcsStatusOf(row) {
  return row?.status || (row?.mirror_verified ? "verified" : "submitted");
}

export function hcsMirrorVerified(row) {
  return Boolean(row?.mirror_verified);
}

export function htsTypeOf(row) {
  return row?.type || "activity";
}

export function htsTokenIdOf(row) {
  return row?.token_id || null;
}

export function htsTransactionIdOf(row) {
  return row?.transaction_id || null;
}

export function htsAccountIdOf(row) {
  return row?.account_id || row?.wallet_account_id || null;
}

export function htsCreatedAtOf(row) {
  return row?.created_at || row?.updated_at || null;
}

export function htsMirrorVerified(row) {
  return Boolean(row?.mirror_verified);
}

export function htsStatusOf(row) {
  return row?.status || (row?.mirror_verified ? "verified" : "submitted");
}

export function htsSymbolOf(row) {
  return row?.symbol || row?.token_symbol || null;
}

export function htsNameOf(row) {
  return row?.name || row?.token_name || null;
}

export function htsSerialOf(row) {
  const n = Number(row?.serial_number ?? row?.serial);
  return Number.isFinite(n) ? n : null;
}

export function htsTitleOf(row, fallback = "HTS transaction") {
  return (
    htsSymbolOf(row) ||
    htsNameOf(row) ||
    htsTokenIdOf(row) ||
    fallback
  );
}

export function htsBestObservedAtOf(row) {
  return (
    row?.consensus_timestamp ||
    row?.created_at ||
    row?.valid_start_timestamp ||
    row?.updated_at ||
    row?.mirror_verified_at ||
    null
  );
}

export function htsPayerAccountIdOf(row) {
  return row?.payer_account_id || null;
}

export function htsMemoOf(row) {
  return row?.memo || null;
}

export function htsBatchGroupIdOf(row) {
  return row?.batch_group_id || null;
}

export function htsIdempotencyKeyOf(row) {
  return row?.idempotency_key || null;
}

export function htsBatchCountOf(row) {
  const n = Number(row?.op_count ?? row?.batch_count);
  return Number.isFinite(n) ? n : null;
}

export function htsHasAnchor(row) {
  return Boolean(htsTransactionIdOf(row));
}

export function hcsMessageDetailPath(messageId) {
  const raw = String(messageId || "").trim();
  return raw ? `/app/hedera/hcs/messages/${encodeURIComponent(raw)}` : "/app/hedera/hcs";
  }

export function hcsTransactionDetailPath(transactionId) {
  const raw = String(transactionId || "").trim();
  return raw
    ? `/app/hedera/hcs/transactions/${encodeURIComponent(raw)}`
    : "/app/hedera/hcs";
}

export function hcsDetailPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/app/hedera/hcs";

  const isTransactionId =
    /^\d+\.\d+\.\d+@\d+\.\d+$/.test(raw) || /^(\d+\.\d+\.\d+)@(\d+)-(\d+)$/.test(raw);

  return isTransactionId
    ? hcsTransactionDetailPath(raw)
    : hcsMessageDetailPath(raw);
}

export function hcsBestDetailPath(row) {
  const messageId = hcsMessageIdOf(row);
  if (messageId) return hcsMessageDetailPath(messageId);

  const transactionId = hcsTransactionIdOf(row);
  return transactionId ? hcsTransactionDetailPath(transactionId) : "/app/hedera/hcs";
}

export function htsDetailPath(transactionId) {
  const raw = String(transactionId || "").trim();
  return raw
    ? `/app/hedera/hts/transactions/${encodeURIComponent(raw)}`
    : "/app/hedera/hts";
}

export function hederaDecryptPath(opts = {}) {
  const sp = new URLSearchParams();

  const messageId = String(opts.messageId || "").trim();
  const transactionId = String(opts.transactionId || "").trim();
  const mode = String(opts.mode || "").trim();

  if (messageId) {
    sp.set("message_id", messageId);
  } else if (transactionId) {
    sp.set("transaction_id", transactionId);
  }

  if (
    mode === "verify_only" ||
    mode === "decrypt_only" ||
    mode === "decrypt_and_verify"
  ) {
    sp.set("mode", mode);
  }

  const qs = sp.toString();
  return qs ? `/app/hedera/decrypt?${qs}` : "/app/hedera/decrypt";
}

export function safeJsonStringify(value, fallback = "—") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}