// ============================================================================
// File: src/lib/hcs.js
// Purpose: Normalize HCS identifiers and build HashScan links.
// ============================================================================

const DEFAULT_NETWORK =
  String(import.meta.env.VITE_HEDERA_NETWORK || "testnet").trim().toLowerCase();

function networkBase(network) {
  if (network === "mainnet") return "https://hashscan.io/mainnet";
  if (network === "previewnet") return "https://hashscan.io/previewnet";
  return "https://hashscan.io/testnet";
}

function isTxnId(value) {
  return /^\d+\.\d+\.\d+@\d+\.\d+$/.test(String(value || "").trim());
}

function isMessageId(value) {
  return /^\d+@0\.0\.\d+$/.test(String(value || "").trim());
}

function isTopicId(value) {
  return /^0\.0\.\d+$/.test(String(value || "").trim());
}

export function buildHcsLink(rawId, network = DEFAULT_NETWORK) {
  const raw = String(rawId || "").trim();
  if (!raw) return { label: "", href: "" };

  const base = networkBase(network);

  if (isTxnId(raw)) {
    return {
      label: raw,
      href: `${base}/transaction/${encodeURIComponent(raw)}`,
    };
  }

  if (isMessageId(raw)) {
    const [seq, topicId] = raw.split("@");
    return {
      label: raw,
      href: `${base}/topic/${encodeURIComponent(topicId)}/message/${encodeURIComponent(seq)}`,
    };
  }

  if (isTopicId(raw)) {
    return {
      label: raw,
      href: `${base}/topic/${encodeURIComponent(raw)}`,
    };
  }

  return {
    label: raw,
    href: "",
  };
}