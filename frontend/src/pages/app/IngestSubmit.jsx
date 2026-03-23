import React from "react";
import { Link } from "react-router-dom";
import {
  FlaskConical,
  RefreshCw,
  ShieldCheck,
  ScrollText,
  FileCheck2,
  Play,
  Search,
  Layers3,
  Copy,
  ArrowRight,
  Link2,
  History,
  FolderTree,
  Radio,
  ListTree,
  Hash,
  CheckCircle2,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import JsonBlock from "@/components/entities/json-block.jsx";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import HashscanButton from "@/components/hedera/hashscan-button.jsx";
import { HcsTxLabel } from "@/components/hedera/hcs-tx-link.jsx";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObjectInput(raw, emptyValue = null) {
  const text = String(raw || "").trim();
  if (!text) return emptyValue;

  const parsed = JSON.parse(text);
  if (!isPlainObject(parsed)) {
    throw new Error("JSON must be an object.");
  }
  return parsed;
}

function requireJsonObjectInput(raw, label) {
  const parsed = parseJsonObjectInput(raw, null);
  if (!parsed) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
}

function parseJsonAnyInput(raw, emptyValue = null) {
  const text = String(raw || "").trim();
  if (!text) return emptyValue;
  return JSON.parse(text);
}

function shortHash(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function deriveIngestPosture(entitlements, membership) {
  const canUseIngest = Boolean(entitlements?.canUseIngest);
  const canMintCertificates = Boolean(entitlements?.canMintCertificates);
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  return {
    canUseIngest,
    canMintCertificates,
    canAnchor: canUseIngest,
    canRegisterAndAnchor: canUseIngest && isTenantAdmin,
    isTenantAdmin,
  };
}

function SummaryCard({ icon: Icon, title, value, hint }) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader className="pb-3">
        <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </CardDescription>
        <CardTitle className="text-2xl tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function buildIdentity(form) {
  return {
    object_key: String(form.objectKey || "").trim(),
    object_kind: String(form.objectKind || "").trim(),
    ...(String(form.program || "").trim() ? { program: String(form.program).trim() } : {}),
    ...(String(form.versionLabel || "").trim()
      ? { version_label: String(form.versionLabel).trim() }
      : {}),
  };
}

function buildSubmitBody(form) {
  const metadata = parseJsonObjectInput(form.metadataText, {});
  const evidence = requireJsonObjectInput(form.evidenceText, "Evidence JSON");

  return {
    mode: "register_and_anchor",
    identity: buildIdentity(form),
    evidence,
    domain: String(form.domain || "").trim(),
    proof_date: String(form.proofDate || "").trim(),
    ...(metadata ? { metadata } : {}),
    ...(String(form.evidencePointer || "").trim()
      ? { evidence_pointer: String(form.evidencePointer).trim() }
      : {}),
  };
}

function validateSubmitForm(form) {
  const objectKey = String(form.objectKey || "").trim();
  const objectKind = String(form.objectKind || "").trim();
  const domain = String(form.domain || "").trim();
  const proofDate = String(form.proofDate || "").trim();
  const evidencePointer = String(form.evidencePointer || "").trim();

  if (!objectKey) throw new Error("Object key is required.");
  if (!objectKind) throw new Error("Object kind is required.");
  if (!domain) throw new Error("Domain is required.");
  if (!proofDate) throw new Error("Proof date is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proofDate)) {
    throw new Error("Proof date must use YYYY-MM-DD.");
  }
  if (!evidencePointer) throw new Error("Evidence pointer is required.");
  requireJsonObjectInput(form.evidenceText, "Evidence JSON");
  parseJsonObjectInput(form.metadataText, {});
}

function isSubmitReady(form, posture) {
  const objectKey = String(form.objectKey || "").trim();
  const objectKind = String(form.objectKind || "").trim();
  const domain = String(form.domain || "").trim();
  const proofDate = String(form.proofDate || "").trim();
  const evidencePointer = String(form.evidencePointer || "").trim();

  if (!posture.canRegisterAndAnchor) return false;
  if (!objectKey || !objectKind || !domain || !proofDate || !evidencePointer) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proofDate)) return false;

  try {
    requireJsonObjectInput(form.evidenceText, "Evidence JSON");
    parseJsonObjectInput(form.metadataText, {});
    return true;
  } catch {
    return false;
  }
}

function getLatestEvidence(result) {
  return result?.result?.evidence ?? result?.evidence ?? null;
}

function getLatestReceipt(result) {
  return result?.result?.receipt ?? result?.receipt ?? null;
}

function getLatestCore(result) {
  return result?.result?.core ?? result?.core ?? null;
}

function getLatestReceiptAnchor(result) {
  const core = getLatestCore(result);
  return core?.receipt_anchor ?? null;
}

function getLatestRootBuild(result) {
  const core = getLatestCore(result);
  return core?.root_build ?? null;
}

function getLatestRootPublish(result) {
  const core = getLatestCore(result);
  return core?.root_publish ?? null;
}

function getLatestRootAnchor(result) {
  const core = getLatestCore(result);
  return core?.root_anchor ?? null;
}

function getLatestBundle(result) {
  return result?.result?.evidence?.bundle ?? result?.evidence?.bundle ?? null;
}

function getNestedAnchorBlock(row) {
  return isPlainObject(row?.anchor) ? row.anchor : null;
}

function getAnchorStatus(row) {
  const anchor = getNestedAnchorBlock(row);
  return (
    String(anchor?.status || row?.anchor_status || row?.status || "")
      .trim()
      .toLowerCase() || "unknown"
  );
}

function getResolvedRequestId(result) {
  const receiptAnchor = getLatestReceiptAnchor(result);
  const rootAnchor = getLatestRootAnchor(result);
  const receiptAnchorRow = getNestedAnchorBlock(receiptAnchor);
  const rootAnchorRow = getNestedAnchorBlock(rootAnchor);

  return String(receiptAnchorRow?.id || rootAnchorRow?.id || "").trim();
}

function getResolvedObjectKey(result) {
  return (
    result?.result?.receipt?.identity?.object_key ||
    result?.result?.evidence?.object_key ||
    result?.receipt?.identity?.object_key ||
    result?.evidence?.object_key ||
    ""
  );
}

function getResolvedObjectKind(result) {
  return (
    result?.result?.receipt?.identity?.object_kind ||
    result?.result?.evidence?.object_kind ||
    result?.receipt?.identity?.object_kind ||
    result?.evidence?.object_kind ||
    ""
  );
}

function getResolvedDomain(result) {
  return (
    result?.result?.receipt?.anchor?.domain ||
    result?.receipt?.anchor?.domain ||
    getLatestRootPublish(result)?.domain ||
    getNestedAnchorBlock(getLatestRootAnchor(result))?.domain ||
    ""
  );
}

function getResolvedProofDate(result) {
  return (
    result?.result?.receipt?.anchor?.proof_date ||
    result?.receipt?.anchor?.proof_date ||
    getLatestRootPublish(result)?.proof_date ||
    getNestedAnchorBlock(getLatestRootAnchor(result))?.proof_date ||
    ""
  );
}

function summarizeTrust(core) {
  const receiptAnchor = core?.receipt_anchor ?? null;
  const rootBuild = core?.root_build ?? null;
  const rootPublish = core?.root_publish ?? null;
  const rootAnchor = core?.root_anchor ?? null;

  const receiptAnchorRow = getNestedAnchorBlock(receiptAnchor);
  const rootAnchorRow = getNestedAnchorBlock(rootAnchor);

  const receiptAnchorStatus = getAnchorStatus(receiptAnchor);
  const rootAnchorStatus = getAnchorStatus(rootAnchor);
  const rootPublishStatus = String(rootPublish?.status || "").trim().toLowerCase();

  const publicationTxn =
    rootPublish?.hcs_transaction_id ||
    rootPublish?.publish?.hcs_transaction_id ||
    rootPublish?.publish?.transaction_id ||
    rootPublish?.anchor_hcs_transaction_id ||
    rootPublish?.anchor_hcs_message_id ||
    null;

  return {
    receiptAnchorCreated: Boolean(receiptAnchorRow?.id),
    rootBuilt: Boolean(rootBuild?.id || rootBuild?.root_id),
    rootPublished:
      rootPublishStatus === "published" ||
      rootPublishStatus === "verified" ||
      Boolean(publicationTxn),
    rootAnchored:
      rootAnchorStatus === "published" ||
      rootAnchorStatus === "confirmed" ||
      Boolean(rootAnchorRow?.hcs_transaction_id || rootAnchorRow?.hcs_message_id),
    confirmed: rootAnchorStatus === "confirmed",
    failed:
      receiptAnchorStatus === "failed" ||
      rootPublishStatus === "failed" ||
      rootAnchorStatus === "failed",
  };
}

function summarizeReplay(core) {
  const rootBuild = core?.root_build || null;
  const rootPublish = core?.root_publish || null;
  const reused =
    rootBuild?.reused_existing_root === true ||
    rootPublish?.reused_existing_root === true;
  const replayReason =
    rootPublish?.reason ||
    rootBuild?.reason ||
    "—";

  return {
    replay: reused,
    reused,
    replayReason,
  };
}

function summarizeEvidence(evidence) {
  return {
    fingerprint: evidence?.fingerprint || null,
    bundleDigest: evidence?.bundle_digest || null,
    merkleRoot: evidence?.merkle_root || null,
    idempotencyKey: evidence?.idempotency_key || null,
    itemCount: Number(evidence?.bundle?.summary?.item_count ?? 0) || 0,
    totalBytes: Number(evidence?.bundle?.summary?.total_bytes ?? 0) || 0,
  };
}

async function copyJson(value, label, setPageNotice, setPageError) {
  try {
    const text = JSON.stringify(value ?? null, null, 2);
    await navigator.clipboard.writeText(text);
    setPageError("");
    setPageNotice(`${label} copied to clipboard.`);
  } catch {
    setPageError(`Failed to copy ${String(label || "JSON").toLowerCase()}.`);
  }
}

function TrustSummaryCard({ core }) {
  const summary = summarizeTrust(core);
  const replay = summarizeReplay(core);

  return (
    <Card className="border-border/60 bg-card/25">
      <CardHeader>
        <CardTitle className="text-base">Submission summary</CardTitle>
        <CardDescription>
          Status for the current submit run.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Receipt anchor</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.receiptAnchorCreated ? "Created" : "Not present"}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Root publication</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.rootPublished ? "Published" : "Not published"}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Root anchor</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.confirmed ? "Confirmed" : summary.rootAnchored ? "Anchored" : "Pending"}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Replay posture</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.failed ? "Failed" : replay.reused ? "Reused" : replay.replay ? "Replay detected" : "Fresh execution"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{replay.replayReason}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HcsActionRow({ title, transactionId, messageId, verified = false, loading = false }) {
  const primaryId = String(transactionId || messageId || "").trim();
  if (!primaryId) return null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>

      <div className="mt-2 min-w-0">
        <HcsTxLabel id={primaryId} monoClassName="text-[0.72rem]" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MirrorStatusPill
          hasAnchor={true}
          mirrorVerified={verified}
          loading={loading}
          size="sm"
        />
        <HashscanButton id={primaryId} size="sm" />
      </div>
    </div>
  );
}

function VerifyResultCards({ verifyResult }) {
  const root = verifyResult?.result ?? verifyResult ?? null;
  const receiptVerify = root?.receipt_verify ?? null;
  const bundleVerify = root?.bundle_verify ?? null;
  const localVerify = root?.local_verify ?? null;

  function cardValue(v) {
    if (!v) return "—";
    return v.ok ? "Passed" : "Failed";
  }

  function cardHint(v) {
    if (!v) return "No verification block returned.";
    return v.reason || v.message || (v.ok ? "Verification succeeded." : "Verification failed.");
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <SummaryCard
        icon={ScrollText}
        title="Receipt verify"
        value={cardValue(receiptVerify)}
        hint={cardHint(receiptVerify)}
      />
      <SummaryCard
        icon={Layers3}
        title="Bundle verify"
        value={cardValue(bundleVerify)}
        hint={cardHint(bundleVerify)}
      />
      <SummaryCard
        icon={FolderTree}
        title="Local verify"
        value={cardValue(localVerify)}
        hint={cardHint(localVerify)}
      />
    </div>
  );
}

export default function IngestSubmitPage() {
  const { org, user, membership, entitlements, refreshAppContext } = useAppContext();

  const posture = React.useMemo(
    () => deriveIngestPosture(entitlements, membership),
    [entitlements, membership]
  );

  const [activePanel, setActivePanel] = React.useState("result");
  const [busyAction, setBusyAction] = React.useState("");
  const [pageError, setPageError] = React.useState("");
  const [pageNotice, setPageNotice] = React.useState("");
  const [submitResult, setSubmitResult] = React.useState(null);
  const [verifyResult, setVerifyResult] = React.useState(null);
  const [hasTriedSubmit, setHasTriedSubmit] = React.useState(false);

  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [form, setForm] = React.useState({
    objectKey: org?.id ? `${org.id}.ingest.example.object.v1` : "",
    objectKind: "file_set",
    program: "program",
    versionLabel: "v1",
    domain: org?.id ? `hf:ingest|org:${org.id}` : "",
    proofDate: today,
    evidencePointer: "",
    metadataText: `{
  "source": "hf-local-package",
  "proof_date": "${today}"
}`,
    evidenceText: `{
  "object_key": "",
  "object_kind": "file_set",
  "fingerprint": "",
  "bundle_digest": "",
  "merkle_root": "",
  "idempotency_key": "",
  "bundle": {
    "summary": {
      "item_count": 0,
      "total_bytes": 0
    }
  }
}`,
    verifyReceiptText: "",
    verifyBundleText: "",
    verifyRootDir: "",
  });

  React.useEffect(() => {
    if (!String(form.objectKey || "").trim() && org?.id) {
      setForm((prev) => ({
        ...prev,
        objectKey: `${org.id}.ingest.example.object.v1`,
      }));
    }
  }, [org?.id, form.objectKey]);

  const submitReady = React.useMemo(() => isSubmitReady(form, posture), [form, posture]);

  const objectKeyMissing =
    hasTriedSubmit &&
    !String(form.objectKey || "").trim();

  const objectKindMissing =
    hasTriedSubmit &&
    !String(form.objectKind || "").trim();

  const domainMissing =
    hasTriedSubmit &&
    !String(form.domain || "").trim();

  const proofDateMissing =
    hasTriedSubmit &&
    !String(form.proofDate || "").trim();

  const proofDateInvalid =
    hasTriedSubmit &&
    Boolean(String(form.proofDate || "").trim()) &&
    !/^\d{4}-\d{2}-\d{2}$/.test(String(form.proofDate || "").trim());

  const evidencePointerMissing =
    hasTriedSubmit &&
    !String(form.evidencePointer || "").trim();

  const evidenceInvalid = React.useMemo(() => {
    if (!hasTriedSubmit) return false;
    try {
      const parsed = parseJsonObjectInput(form.evidenceText, null);
      return !parsed;
    } catch {
      return true;
    }
  }, [form.evidenceText, hasTriedSubmit]);

  const metadataInvalid = React.useMemo(() => {
    if (!hasTriedSubmit) return false;
    try {
      parseJsonObjectInput(form.metadataText, {});
      return false;
    } catch {
      return true;
    }
  }, [form.metadataText, hasTriedSubmit]);

  function updateForm(field, value) {
    setPageError("");
    setPageNotice("");
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleSubmit() {
    setHasTriedSubmit(true);
    setBusyAction("submit");
    setPageError("");
    setPageNotice("");
    setSubmitResult(null);

    try {
      if (!posture.canRegisterAndAnchor) {
        throw new Error("Local-first ingest submit requires tenant-admin or system-admin posture.");
      }

      validateSubmitForm(form);

      const payload = await fetchJsonOrThrow("/v1/ingest/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSubmitBody(form)),
      });

      setSubmitResult(payload);
      setPageNotice("Local-first ingest submit completed.");
      setActivePanel("result");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
        err?.payload?.upstream_detail?.message ||
        err?.payload?.message ||
        err?.message ||
        "Failed to submit local ingest evidence."
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleVerify() {
    setBusyAction("verify");
    setPageError("");
    setPageNotice("");
    setVerifyResult(null);

    try {
      const receipt = parseJsonAnyInput(form.verifyReceiptText, null);
      const bundle = parseJsonAnyInput(form.verifyBundleText, null);
      const rootDir = String(form.verifyRootDir || "").trim() || null;

      if (!receipt && !bundle && !rootDir) {
        throw new Error("Provide at least one verification input: receipt, bundle, or root directory.");
      }

      const payload = await fetchJsonOrThrow("/v1/ingest/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(receipt ? { receipt } : {}),
          ...(bundle ? { bundle } : {}),
          ...(rootDir ? { root_dir: rootDir } : {}),
        }),
      });

      setVerifyResult(payload);
      setPageNotice("Ingest verification completed.");
      setActivePanel("verify");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
        err?.payload?.upstream_detail?.message ||
        err?.payload?.message ||
        err?.message ||
        "Failed to verify ingest artifacts."
      );
    } finally {
      setBusyAction("");
    }
  }

  const evidence = getLatestEvidence(submitResult);
  const receipt = getLatestReceipt(submitResult);
  const core = getLatestCore(submitResult);
  const receiptAnchor = getLatestReceiptAnchor(submitResult);
  const rootBuild = getLatestRootBuild(submitResult);
  const rootPublish = getLatestRootPublish(submitResult);
  const rootAnchor = getLatestRootAnchor(submitResult);

  const requestId = getResolvedRequestId(submitResult);
  const objectKeyFromResult = getResolvedObjectKey(submitResult);
  const objectKindFromResult = getResolvedObjectKind(submitResult);
  const domainFromResult = getResolvedDomain(submitResult);
  const proofDateFromResult = getResolvedProofDate(submitResult);

  const evidenceSummary = summarizeEvidence(evidence);

  const receiptAnchorTxnId =
    getNestedAnchorBlock(receiptAnchor)?.hcs_transaction_id ||
    receiptAnchor?.publish?.transaction_id ||
    receiptAnchor?.publish?.hcs_transaction_id ||
    "";

  const receiptAnchorMsgId =
    getNestedAnchorBlock(receiptAnchor)?.hcs_message_id ||
    receiptAnchor?.publish?.message_id ||
    receiptAnchor?.publish?.hcs_message_id ||
    "";

  const rootPublishTxnId =
    rootPublish?.hcs_transaction_id ||
    rootPublish?.publish?.hcs_transaction_id ||
    rootPublish?.publish?.transaction_id ||
    rootPublish?.anchor_hcs_transaction_id ||
    "";

  const rootPublishMsgId =
    rootPublish?.hcs_message_id ||
    rootPublish?.publish?.hcs_message_id ||
    rootPublish?.publish?.message_id ||
    rootPublish?.anchor_hcs_message_id ||
    "";

  const rootAnchorTxnId =
    getNestedAnchorBlock(rootAnchor)?.hcs_transaction_id ||
    rootAnchor?.publish?.transaction_id ||
    rootAnchor?.publish?.hcs_transaction_id ||
    "";

  const rootAnchorMsgId =
    getNestedAnchorBlock(rootAnchor)?.hcs_message_id ||
    rootAnchor?.publish?.message_id ||
    rootAnchor?.publish?.hcs_message_id ||
    "";

  const requestStatus =
    getAnchorStatus(rootAnchor) !== "unknown"
      ? getAnchorStatus(rootAnchor)
      : String(rootPublish?.status || rootBuild?.status || getAnchorStatus(receiptAnchor) || "unknown");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/ingest" className="hover:underline">
              Ingest
            </Link>
            <span className="mx-2">/</span>
            <span>Local-first submit</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Local-first ingest submit
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Submit deterministic evidence from a local run and let HF finalize the anchored ingest workflow.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload context
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/ingest/anchor">
              <FolderTree className="mr-2 h-4 w-4" />
              Guided ingest
            </Link>
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/ingest/requests">
              <ListTree className="mr-2 h-4 w-4" />
              Requests
            </Link>
          </Button>
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      {pageNotice ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {pageNotice}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Ingest"
          value={posture.canUseIngest ? "Enabled" : "Restricted"}
          hint="This workspace can use ingest workflows."
          icon={FlaskConical}
        />
        <EntitySummaryCard
          title="Finalization"
          value={posture.canRegisterAndAnchor ? "Available" : "Limited"}
          hint="Anchored local-first submit requires elevated tenant posture."
          icon={ShieldCheck}
        />
        <EntitySummaryCard
          title="Org"
          value={org?.name || "No org"}
          hint={org?.id || "No current org context"}
          icon={FolderTree}
        />
        <EntitySummaryCard
          title="User"
          value={user?.displayName || user?.email || "Authenticated user"}
          hint={membership?.role === "tenant_admin" ? "Tenant admin" : (membership?.role || "Unknown role")}
          icon={ScrollText}
        />
      </div>

      <EntitySection
        title="Workflow posture"
        description="Use this page after evidence has already been computed locally."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FileCheck2 className="h-4 w-4" />
              Evidence handoff
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Submit evidence, identity, and a durable artifact pointer.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <CheckCircle2 className="h-4 w-4" />
              HF finalization
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              HF validates the payload and completes the anchored workflow.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Search className="h-4 w-4" />
              Verification-ready
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Returned receipts and bundles can be verified immediately.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={posture.canUseIngest ? "success" : "warn"}>
            ingest {posture.canUseIngest ? "enabled" : "restricted"}
          </Badge>
          <Badge variant={posture.canRegisterAndAnchor ? "success" : "warn"}>
            local-first submit {posture.canRegisterAndAnchor ? "available" : "limited"}
          </Badge>
          <Badge variant={posture.isTenantAdmin ? "success" : "outline"}>
            role {membership?.role || "unknown"}
          </Badge>
        </div>
      </EntitySection>

      <EntitySection
        title="Compose submit request"
        description="Paste the local evidence object, then provide the identity and durable pointer HF should bind to anchored ingest state."
      >
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Object key</label>
                <input
                  type="text"
                  value={form.objectKey}
                  onChange={(e) => updateForm("objectKey", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                    objectKeyMissing ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder="org.program.object.variant.v1"
                />
                {objectKeyMissing ? (
                  <p className="text-xs text-amber-300">Object key is required.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Object kind</label>
                <input
                  type="text"
                  value={form.objectKind}
                  onChange={(e) => updateForm("objectKind", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none ${
                    objectKindMissing ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder="file_set"
                />
                {objectKindMissing ? (
                  <p className="text-xs text-amber-300">Object kind is required.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Program</label>
                <input
                  type="text"
                  value={form.program}
                  onChange={(e) => updateForm("program", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="program"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Version label</label>
                <input
                  type="text"
                  value={form.versionLabel}
                  onChange={(e) => updateForm("versionLabel", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="v1"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Proof date</label>
                <input
                  type="date"
                  value={form.proofDate}
                  onChange={(e) => updateForm("proofDate", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none ${
                    proofDateMissing || proofDateInvalid ? "border-amber-500/60" : "border-border"
                  }`}
                />
                {proofDateMissing ? (
                  <p className="text-xs text-amber-300">Proof date is required.</p>
                ) : null}
                {proofDateInvalid ? (
                  <p className="text-xs text-amber-300">Proof date must use YYYY-MM-DD.</p>
                ) : null}
              </div>

              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Domain</label>
                <input
                  type="text"
                  value={form.domain}
                  onChange={(e) => updateForm("domain", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                    domainMissing ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder="hf:ingest|org:<org_id>"
                />
                {domainMissing ? (
                  <p className="text-xs text-amber-300">Domain is required.</p>
                ) : null}
              </div>

              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Evidence pointer</label>
                <input
                  type="text"
                  value={form.evidencePointer}
                  onChange={(e) => updateForm("evidencePointer", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                    evidencePointerMissing ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder="file://..., s3://..., r2://..., or other durable artifact pointer"
                />
                {evidencePointerMissing ? (
                  <p className="text-xs text-amber-300">Evidence pointer is required.</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">Evidence JSON</label>
              <textarea
                value={form.evidenceText}
                onChange={(e) => updateForm("evidenceText", e.target.value)}
                className={`min-h-72 w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                  evidenceInvalid ? "border-amber-500/60" : "border-border"
                }`}
                placeholder='{"fingerprint":"","bundle_digest":"","merkle_root":"","idempotency_key":"","bundle":{"summary":{"item_count":0,"total_bytes":0}}}'
              />
              {evidenceInvalid ? (
                <p className="text-xs text-amber-300">
                  Evidence JSON is required and must parse to a JSON object.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">Metadata JSON</label>
              <textarea
                value={form.metadataText}
                onChange={(e) => updateForm("metadataText", e.target.value)}
                className={`min-h-36 w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                  metadataInvalid ? "border-amber-500/60" : "border-border"
                }`}
                placeholder='{"source":"hf-local-package"}'
              />
              {metadataInvalid ? (
                <p className="text-xs text-amber-300">
                  Metadata must be valid JSON and must parse to a JSON object.
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Request summary</CardTitle>
                <CardDescription>
                  Review the request before submission.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Object key</span>
                  <span className="font-mono text-xs text-foreground/90">{form.objectKey || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Object kind</span>
                  <span className="text-foreground/90">{form.objectKind || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Domain</span>
                  <span className="font-mono text-xs text-foreground/90">{form.domain || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Proof date</span>
                  <span className="text-foreground/90">{form.proofDate || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Program</span>
                  <span className="text-foreground/90">{form.program || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Version label</span>
                  <span className="text-foreground/90">{form.versionLabel || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Evidence JSON</span>
                  <span className="text-foreground/90">
                    {String(form.evidenceText || "").trim() ? "Provided" : "Required"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Evidence pointer</span>
                  <span className="text-foreground/90">
                    {String(form.evidencePointer || "").trim() ? "Provided" : "Required"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
                <CardDescription>
                  Finalize the submit flow or move to verification.
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                <Button
                  type="button"
                  disabled={Boolean(busyAction) || !submitReady}
                  onClick={() => void handleSubmit()}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {busyAction === "submit" ? "Submitting..." : "Finalize submit"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  disabled={busyAction === "verify"}
                  onClick={() => setActivePanel("verify")}
                >
                  <Search className="mr-2 h-4 w-4" />
                  Open verify workspace
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </EntitySection>

      <EntitySection
        title="Result workspace"
        description="Inspect the finalized submit response or verify the returned receipt and bundle."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "result", label: "Result" },
            { key: "verify", label: "Verify" },
          ].map((item) => (
            <Button
              key={item.key}
              type="button"
              variant={activePanel === item.key ? "default" : "outline"}
              onClick={() => setActivePanel(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {activePanel === "result" ? (
          <div className="space-y-4">
            {!submitResult ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
                No local-first submit has been run yet.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const latestReceipt = getLatestReceipt(submitResult);
                      const latestBundle = getLatestBundle(submitResult);

                      setForm((prev) => ({
                        ...prev,
                        verifyReceiptText: latestReceipt ? JSON.stringify(latestReceipt, null, 2) : prev.verifyReceiptText,
                        verifyBundleText: latestBundle ? JSON.stringify(latestBundle, null, 2) : prev.verifyBundleText,
                      }));
                      setActivePanel("verify");
                    }}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Verify this result
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void copyJson(getLatestReceipt(submitResult), "Receipt", setPageNotice, setPageError)
                    }
                  >
                    <ScrollText className="mr-2 h-4 w-4" />
                    Copy receipt
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void copyJson(getLatestBundle(submitResult), "Bundle", setPageNotice, setPageError)
                    }
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy bundle
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busyAction) || !submitReady}
                    onClick={() => void handleSubmit()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Run again
                  </Button>

                  {requestId ? (
                    <Button asChild>
                      <Link to={`/app/ingest/requests/${encodeURIComponent(requestId)}`}>
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Open request detail
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link to="/app/ingest/requests">
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Open requests registry
                      </Link>
                    </Button>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <EntitySummaryCard
                    title="Object key"
                    value={objectKeyFromResult || "—"}
                    hint="Resolved ingest identity returned by the submit flow."
                    icon={FlaskConical}
                  />
                  <EntitySummaryCard
                    title="Object kind"
                    value={objectKindFromResult || "—"}
                    hint="Resolved object kind returned by the submit flow."
                    icon={Radio}
                  />
                  <EntitySummaryCard
                    title="Fingerprint"
                    value={shortHash(evidenceSummary.fingerprint)}
                    hint="Deterministic fingerprint submitted from the local run."
                    icon={ShieldCheck}
                  />
                  <EntitySummaryCard
                    title="Bundle digest"
                    value={shortHash(evidenceSummary.bundleDigest)}
                    hint="Digest of the locally computed bundle."
                    icon={Layers3}
                  />
                  <EntitySummaryCard
                    title="Request status"
                    value={requestStatus || "—"}
                    hint={requestId ? shortHash(requestId) : "No anchor id returned"}
                    icon={History}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <EntitySummaryCard
                    title="Domain"
                    value={domainFromResult || "—"}
                    hint="Resolved domain used for finalization."
                    icon={FolderTree}
                  />
                  <EntitySummaryCard
                    title="Proof date"
                    value={proofDateFromResult || "—"}
                    hint="Proof date bound to the finalized ingest receipt."
                    icon={ScrollText}
                  />
                </div>

                <TrustSummaryCard core={core} />

                <div className="grid gap-4 xl:grid-cols-3">
                  <HcsActionRow
                    title="Receipt anchor transaction"
                    transactionId={receiptAnchorTxnId}
                    messageId={receiptAnchorMsgId}
                    verified={false}
                  />
                  <HcsActionRow
                    title="Root publish transaction"
                    transactionId={rootPublishTxnId}
                    messageId={rootPublishMsgId}
                    verified={Boolean(rootPublish?.mirror_verified)}
                  />
                  <HcsActionRow
                    title="Root anchor transaction"
                    transactionId={rootAnchorTxnId}
                    messageId={rootAnchorMsgId}
                    verified={getAnchorStatus(rootAnchor) === "confirmed"}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-4">
                  <SummaryCard
                    icon={FileCheck2}
                    title="Items"
                    value={String(evidenceSummary.itemCount || 0)}
                    hint="Item count reported in the submitted bundle summary."
                  />
                  <SummaryCard
                    icon={FlaskConical}
                    title="Total bytes"
                    value={Number(evidenceSummary.totalBytes || 0).toLocaleString()}
                    hint="Byte total reported in the submitted bundle summary."
                  />
                  <SummaryCard
                    icon={Link2}
                    title="Merkle root"
                    value={shortHash(evidenceSummary.merkleRoot)}
                    hint="Deterministic Merkle root carried into finalization."
                  />
                  <SummaryCard
                    icon={Hash}
                    title="Idempotency"
                    value={shortHash(evidenceSummary.idempotencyKey)}
                    hint="Idempotency key used for replay-safe submit behavior."
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Evidence</CardTitle>
                      <CardDescription>
                        Deterministic evidence submitted from the local run.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={evidence} emptyLabel="No evidence" />
                    </CardContent>
                  </Card>

                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Receipt</CardTitle>
                      <CardDescription>
                        Ingest receipt returned by the submit flow.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={receipt} emptyLabel="No receipt" />
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Receipt anchor</CardTitle>
                      <CardDescription>
                        Receipt anchor output returned during finalization.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={receiptAnchor} emptyLabel="No receipt anchor output" />
                    </CardContent>
                  </Card>

                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Root anchor</CardTitle>
                      <CardDescription>
                        Root anchor output returned during finalization.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={rootAnchor} emptyLabel="No root anchor output" />
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Root build</CardTitle>
                      <CardDescription>
                        Merkle root build output returned by the submit route.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={rootBuild} emptyLabel="No root build output" />
                    </CardContent>
                  </Card>

                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Root publish</CardTitle>
                      <CardDescription>
                        Root publication output returned by the submit route.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={rootPublish} emptyLabel="No root publish output" />
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Core write output</CardTitle>
                    <CardDescription>
                      Anchor request creation, linkage, and replay posture returned by the submit flow.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={core} emptyLabel="No core write output returned" />
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Full submit response</CardTitle>
                    <CardDescription>
                      Raw response returned by the HF ingest submit route.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={submitResult?.result ?? submitResult} emptyLabel="No submit response" />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        ) : null}

        {activePanel === "verify" ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!getLatestReceipt(submitResult)}
                    onClick={() => {
                      const latestReceipt = getLatestReceipt(submitResult);
                      if (!latestReceipt) return;

                      setForm((prev) => ({
                        ...prev,
                        verifyReceiptText: JSON.stringify(latestReceipt, null, 2),
                      }));
                      setPageError("");
                      setPageNotice("Loaded latest receipt into verify input.");
                    }}
                  >
                    Use latest receipt
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={!getLatestBundle(submitResult)}
                    onClick={() => {
                      const latestBundle = getLatestBundle(submitResult);
                      if (!latestBundle) return;

                      setForm((prev) => ({
                        ...prev,
                        verifyBundleText: JSON.stringify(latestBundle, null, 2),
                      }));
                      setPageError("");
                      setPageNotice("Loaded latest bundle into verify input.");
                    }}
                  >
                    Use latest bundle
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Receipt JSON</label>
                  <textarea
                    value={form.verifyReceiptText}
                    onChange={(e) => updateForm("verifyReceiptText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste ingest receipt JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Bundle JSON</label>
                  <textarea
                    value={form.verifyBundleText}
                    onChange={(e) => updateForm("verifyBundleText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste ingest bundle JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Root directory</label>
                  <input
                    type="text"
                    value={form.verifyRootDir}
                    onChange={(e) => updateForm("verifyRootDir", e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="/absolute/path/to/local/object/root"
                  />
                </div>

                <div className="flex justify-end">
                  <Button type="button" disabled={busyAction === "verify"} onClick={() => void handleVerify()}>
                    <Search className="mr-2 h-4 w-4" />
                    {busyAction === "verify" ? "Verifying..." : "Run verify"}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                {verifyResult ? <VerifyResultCards verifyResult={verifyResult} /> : null}
              </div>
            </div>

            {verifyResult ? (
              <Card className="border-border/60 bg-card/25">
                <CardHeader>
                  <CardTitle className="text-base">Verify response</CardTitle>
                  <CardDescription>
                    Raw response returned by the HF ingest verify route.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <JsonBlock value={verifyResult?.result ?? verifyResult} emptyLabel="No verify response" />
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </EntitySection>
    </div>
  );
}