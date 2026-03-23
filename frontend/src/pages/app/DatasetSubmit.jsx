import React from "react";
import { Link } from "react-router-dom";
import {
  Database,
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
  CheckCircle2,
  FolderTree,
  Download,
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
  if (!isPlainObject(parsed)) throw new Error("JSON must be an object.");
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

function deriveDatasetPosture(entitlements, membership) {
  const canUseIngest = Boolean(entitlements?.canUseIngest);
  const canAnchorDatasets =
    Boolean(entitlements?.canAnchorDatasets) ||
    Boolean(entitlements?.canDatasetAnchor) ||
    canUseIngest;
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  return {
    canUseIngest,
    canAnchorDatasets,
    canRegisterAndAnchor: canAnchorDatasets && isTenantAdmin,
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

function normalizePublishVisibility(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "public" || raw === "unlisted") return raw;
  return "";
}

function buildIdentity(form) {
  return {
    dataset_key: String(form.datasetKey || "").trim(),
    ...(String(form.program || "").trim() ? { program: String(form.program).trim() } : {}),
    ...(String(form.versionLabel || "").trim()
      ? { version_label: String(form.versionLabel).trim() }
      : {}),
  };
}

function buildSubmitBody(form) {
  const metadata = parseJsonObjectInput(form.metadataText, {});
  const evidence = parseJsonObjectInput(form.evidenceText, null);
  const visibility = normalizePublishVisibility(form.publishVisibility);

  return {
    mode: "register_and_anchor",
    identity: buildIdentity(form),
    evidence,
    ...(String(form.displayName || "").trim()
      ? { display_name: String(form.displayName).trim() }
      : {}),
    ...(metadata ? { metadata } : {}),
    ...(String(form.evidencePointer || "").trim()
      ? { evidence_pointer: String(form.evidencePointer).trim() }
      : {}),
    ...(visibility ? { publish_visibility: visibility } : {}),
    set_active: Boolean(form.setActive),
  };
}

function validateSubmitForm(form) {
  const datasetKey = String(form.datasetKey || "").trim();
  const evidencePointer = String(form.evidencePointer || "").trim();
  if (!datasetKey) throw new Error("Dataset key is required.");
  if (!evidencePointer) throw new Error("Evidence pointer is required.");
  parseJsonObjectInput(form.evidenceText, null);
  parseJsonObjectInput(form.metadataText, {});
}

function isSubmitReady(form, posture) {
  const datasetKey = String(form.datasetKey || "").trim();
  const evidencePointer = String(form.evidencePointer || "").trim();
  if (!posture.canRegisterAndAnchor) return false;
  if (!datasetKey || !evidencePointer) return false;
  try {
    parseJsonObjectInput(form.evidenceText, null);
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

function getLatestBundle(result) {
  return result?.result?.evidence?.bundle ?? result?.evidence?.bundle ?? null;
}

function getResolvedDatasetKey(result) {
  return (
    result?.result?.core?.dataset?.dataset_key ||
    result?.result?.receipt?.core?.dataset?.dataset_key ||
    result?.result?.evidence?.dataset_key ||
    result?.core?.dataset?.dataset_key ||
    result?.receipt?.core?.dataset?.dataset_key ||
    result?.evidence?.dataset_key ||
    ""
  );
}

function summarizeTrust(core) {
  return {
    datasetCreated: Boolean(core?.dataset?.dataset_id || core?.dataset?.dataset_key),
    versionCreated: Boolean(core?.version?.id || core?.version?.dataset_key),
    published: Boolean(
      core?.published?.published?.dataset || core?.published?.published?.dataset_version
    ),
    certificateIssued: Boolean(
      core?.certificate?.issued || core?.certificate?.certificate?.issued
    ),
  };
}

function summarizeReplay(core) {
  const replay = core?.replay || null;
  return {
    replay: Boolean(replay?.replay),
    reused: Boolean(replay?.reused),
    replayReason: replay?.replay_reason || "—",
  };
}

function summarizeEvidence(evidence) {
  return {
    fingerprint: evidence?.dataset_fingerprint || null,
    bundleDigest: evidence?.bundle_digest || null,
    merkleRoot: evidence?.merkle_root || null,
    idempotencyKey: evidence?.idempotency_key || null,
    fileCount: Number(evidence?.bundle?.summary?.file_count ?? 0) || 0,
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
        <CardDescription>Outcome for the current submit run.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Dataset row</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.datasetCreated ? "Created / updated" : "Not present"}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Version row</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.versionCreated ? "Created" : "Not present"}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Publication</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.published ? "Published" : "Not published"}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Certificate</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.certificateIssued ? "Issued" : "Not issued"}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Replay posture</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {replay.reused ? "Reused" : replay.replay ? "Replay detected" : "Fresh execution"}
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
        <MirrorStatusPill hasAnchor={true} mirrorVerified={verified} loading={loading} size="sm" />
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
      <SummaryCard icon={ScrollText} title="Receipt verify" value={cardValue(receiptVerify)} hint={cardHint(receiptVerify)} />
      <SummaryCard icon={Layers3} title="Bundle verify" value={cardValue(bundleVerify)} hint={cardHint(bundleVerify)} />
      <SummaryCard icon={FolderTree} title="Local verify" value={cardValue(localVerify)} hint={cardHint(localVerify)} />
    </div>
  );
}

export default function DatasetSubmitPage() {
  const { org, user, membership, entitlements, refreshAppContext } = useAppContext();

  const posture = React.useMemo(
    () => deriveDatasetPosture(entitlements, membership),
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
    datasetKey: org?.id ? `${org.id}.sage.example.dataset.v1` : "",
    program: "sage",
    versionLabel: "v1",
    displayName: "",
    evidencePointer: "",
    publishVisibility: "public",
    setActive: true,
    metadataText: `{\n  "source": "hf-local-package",\n  "proof_date": "${today}"\n}`,
    evidenceText: `{\n  "dataset_key": "",\n  "dataset_fingerprint": "",\n  "bundle_digest": "",\n  "merkle_root": "",\n  "idempotency_key": "",\n  "bundle": {\n    "summary": {\n      "file_count": 0,\n      "total_bytes": 0\n    }\n  }\n}`,
    verifyReceiptText: "",
    verifyBundleText: "",
    verifyRootDir: "",
  });

  React.useEffect(() => {
    if (!String(form.datasetKey || "").trim() && org?.id) {
      setForm((prev) => ({ ...prev, datasetKey: `${org.id}.sage.example.dataset.v1` }));
    }
  }, [org?.id, form.datasetKey]);

  const submitReady = React.useMemo(() => isSubmitReady(form, posture), [form, posture]);

  const datasetKeyMissing = hasTriedSubmit && !String(form.datasetKey || "").trim();
  const evidencePointerMissing = hasTriedSubmit && !String(form.evidencePointer || "").trim();

  const evidenceInvalid = React.useMemo(() => {
    if (!hasTriedSubmit) return false;
    try {
      parseJsonObjectInput(form.evidenceText, null);
      return false;
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
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    setHasTriedSubmit(true);
    setBusyAction("submit");
    setPageError("");
    setPageNotice("");
    setSubmitResult(null);

    try {
      if (!posture.canRegisterAndAnchor) {
        throw new Error("Local-first submit requires tenant-admin or system-admin posture.");
      }
      validateSubmitForm(form);
      const payload = await fetchJsonOrThrow("/datasets/anchor/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSubmitBody(form)),
      });
      setSubmitResult(payload);
      setPageNotice("Local-first dataset submit completed.");
      setActivePanel("result");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
        err?.payload?.upstream_detail?.message ||
        err?.payload?.message ||
        err?.message ||
        "Failed to submit local dataset evidence."
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

      const payload = await fetchJsonOrThrow("/datasets/anchor/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(receipt ? { receipt } : {}),
          ...(bundle ? { bundle } : {}),
          ...(rootDir ? { root_dir: rootDir } : {}),
        }),
      });
      setVerifyResult(payload);
      setPageNotice("Dataset verification completed.");
      setActivePanel("verify");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
        err?.payload?.upstream_detail?.message ||
        err?.payload?.message ||
        err?.message ||
        "Failed to verify dataset artifacts."
      );
    } finally {
      setBusyAction("");
    }
  }

  const evidence = getLatestEvidence(submitResult);
  const receipt = getLatestReceipt(submitResult);
  const core = getLatestCore(submitResult);
  const datasetKeyFromResult = getResolvedDatasetKey(submitResult);
  const replay = summarizeReplay(core);
  const evidenceSummary = summarizeEvidence(evidence);

  const datasetTxnId = core?.dataset?.dataset_hcs_transaction_id;
  const datasetMsgId = core?.dataset?.dataset_hcs_message_id;
  const versionTxnId = core?.version?.hcs_transaction_id;
  const versionMsgId = core?.version?.hcs_message_id;
  const certTxnId =
    core?.certificate?.certificate?.nft?.hcs_transaction_id ||
    core?.certificate?.nft?.hcs_transaction_id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/datasets" className="hover:underline">Datasets</Link>
            <span className="mx-2">/</span>
            <span>Local-first submit</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Local-first dataset submit
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Submit deterministic dataset evidence from a local run and let HF finalize dataset, version, publication, and certificate state.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload context
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/datasets/anchor">
              <FolderTree className="mr-2 h-4 w-4" />
              Guided anchor
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

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Dataset anchor access"
          value={posture.canAnchorDatasets ? "Enabled" : "Restricted"}
          hint="Whether this actor can use dataset anchor workflows."
          icon={Database}
        />
        <EntitySummaryCard
          title="Local-first finalization"
          value={posture.canRegisterAndAnchor ? "Available" : "Limited"}
          hint="Finalizing registry-backed state requires elevated tenant posture."
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
          hint={`role ${membership?.role || "unknown"}`}
          icon={ScrollText}
        />
      </div>

      {/* Workflow posture */}
      <EntitySection
        title="Workflow posture"
        description="Use this page after evidence has been computed locally."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FileCheck2 className="h-4 w-4" />
              Evidence handoff
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Submit evidence, identity, and a durable artifact pointer. Raw dataset material stays local.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <CheckCircle2 className="h-4 w-4" />
              HF finalization
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              HF validates the evidence before finalizing dataset, version, publication, and certificate state.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Search className="h-4 w-4" />
              Verification-ready
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Returned receipts and bundles can be verified immediately using the verify workspace.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={posture.canAnchorDatasets ? "success" : "warn"}>
            dataset anchor {posture.canAnchorDatasets ? "enabled" : "restricted"}
          </Badge>
          <Badge variant={posture.canRegisterAndAnchor ? "success" : "warn"}>
            local-first submit {posture.canRegisterAndAnchor ? "available" : "limited"}
          </Badge>
          <Badge variant={posture.isTenantAdmin ? "success" : "outline"}>
            role {membership?.role || "unknown"}
          </Badge>
        </div>
      </EntitySection>

      {/* Compose form */}
      <EntitySection
        title="Compose submit request"
        description="Paste local evidence and provide the dataset identity and publication inputs HF should bind."
      >
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Dataset key</label>
                <input
                  type="text"
                  value={form.datasetKey}
                  onChange={(e) => updateForm("datasetKey", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                    datasetKeyMissing ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder="org.program.dataset.variant.v1"
                />
                {datasetKeyMissing ? (
                  <p className="text-xs text-amber-300">Dataset key is required.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Program</label>
                <input
                  type="text"
                  value={form.program}
                  onChange={(e) => updateForm("program", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="sage"
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

              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Display name</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => updateForm("displayName", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="Human-readable dataset name"
                />
              </div>

              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Evidence JSON</label>
                <textarea
                  value={form.evidenceText}
                  onChange={(e) => updateForm("evidenceText", e.target.value)}
                  className={`min-h-72 w-full rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none ${
                    evidenceInvalid ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder='{"dataset_key":"...","dataset_fingerprint":"...","bundle_digest":"...","merkle_root":"...","idempotency_key":"...","bundle":{...}}'
                />
                <p className="text-xs text-muted-foreground">
                  Paste the deterministic evidence object from the local package or script.
                </p>
                {evidenceInvalid ? (
                  <p className="text-xs text-amber-300">
                    Evidence JSON must be valid and must parse to an object.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Evidence pointer</label>
                <input
                  type="text"
                  value={form.evidencePointer}
                  onChange={(e) => updateForm("evidencePointer", e.target.value)}
                  className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none ${
                    evidencePointerMissing ? "border-amber-500/60" : "border-border"
                  }`}
                  placeholder="s3://..., r2://..., file://..., or other durable artifact pointer"
                />
                <p className="text-xs text-muted-foreground">
                  Durable pointer to the evidence artifact HF should bind into the registry flow.
                </p>
                {evidencePointerMissing ? (
                  <p className="text-xs text-amber-300">Evidence pointer is required.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Publish visibility</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["public", "Public"],
                    ["unlisted", "Unlisted / org-facing"],
                  ].map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={form.publishVisibility === value ? "default" : "outline"}
                      onClick={() => updateForm("publishVisibility", value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Set active</label>
                <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/25 px-3 py-3 text-sm text-foreground/90">
                  <input
                    type="checkbox"
                    checked={Boolean(form.setActive)}
                    onChange={(e) => updateForm("setActive", e.target.checked)}
                  />
                  Set the created version as active
                </label>
              </div>
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
              <p className="text-xs text-muted-foreground">
                Optional metadata for source, provenance, or operator context.
              </p>
              {metadataInvalid ? (
                <p className="text-xs text-amber-300">
                  Metadata must be valid JSON and must parse to a JSON object.
                </p>
              ) : null}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Request summary</CardTitle>
                <CardDescription>Review before submission.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Dataset key</span>
                  <span className="font-mono text-xs text-foreground/90">{form.datasetKey || "—"}</span>
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
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Visibility</span>
                  <span className="text-foreground/90">{form.publishVisibility || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Set active</span>
                  <span className="text-foreground/90">{form.setActive ? "true" : "false"}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
                <CardDescription>
                  Submit precomputed evidence into the registry-backed dataset flow.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button
                  type="button"
                  disabled={Boolean(busyAction) || !submitReady}
                  onClick={() => void handleSubmit()}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {busyAction === "submit" ? "Submitting..." : "Submit local evidence"}
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

      {/* Result workspace */}
      <EntitySection
        title="Result workspace"
        description="Inspect the finalized submit result or verify the resulting receipt and bundle."
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
                No local-first dataset submit has been run yet.
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
                        verifyReceiptText: latestReceipt
                          ? JSON.stringify(latestReceipt, null, 2)
                          : prev.verifyReceiptText,
                        verifyBundleText: latestBundle
                          ? JSON.stringify(latestBundle, null, 2)
                          : prev.verifyBundleText,
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
                  {datasetKeyFromResult ? (
                    <Button asChild>
                      <Link to={`/app/datasets/${encodeURIComponent(datasetKeyFromResult)}`}>
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Open dataset detail
                      </Link>
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <EntitySummaryCard
                    title="Dataset key"
                    value={datasetKeyFromResult || "—"}
                    hint="Resolved dataset identity returned by the submit flow."
                    icon={Database}
                  />
                  <EntitySummaryCard
                    title="Fingerprint"
                    value={shortHash(evidenceSummary.fingerprint)}
                    hint="Deterministic dataset fingerprint submitted from the local flow."
                    icon={ShieldCheck}
                  />
                  <EntitySummaryCard
                    title="Bundle digest"
                    value={shortHash(evidenceSummary.bundleDigest)}
                    hint="Digest of the locally computed dataset bundle."
                    icon={Layers3}
                  />
                  <EntitySummaryCard
                    title="Receipt"
                    value={receipt?.receipt_id ? "Created" : "—"}
                    hint={receipt?.receipt_id ? shortHash(receipt.receipt_id) : "No receipt returned"}
                    icon={ScrollText}
                  />
                  <EntitySummaryCard
                    title="Replay"
                    value={replay.reused ? "Reused" : replay.replay ? "Replay" : "Fresh"}
                    hint={replay.replayReason}
                    icon={History}
                  />
                </div>

                <TrustSummaryCard core={core} />

                <div className="grid gap-4 xl:grid-cols-3">
                  <HcsActionRow
                    title="Dataset registry transaction"
                    transactionId={datasetTxnId}
                    messageId={datasetMsgId}
                    verified={false}
                  />
                  <HcsActionRow
                    title="Dataset version transaction"
                    transactionId={versionTxnId}
                    messageId={versionMsgId}
                    verified={false}
                  />
                  <HcsActionRow
                    title="Certificate transaction"
                    transactionId={certTxnId}
                    verified={false}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-4">
                  <SummaryCard
                    icon={FileCheck2}
                    title="Files"
                    value={String(evidenceSummary.fileCount || 0)}
                    hint="File count reported in the submitted bundle summary."
                  />
                  <SummaryCard
                    icon={Database}
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
                    icon={History}
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
                        Deterministic evidence submitted from the local package or script.
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
                        Dataset anchor receipt with Core write enrichment.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={receipt} emptyLabel="No receipt" />
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Core write output</CardTitle>
                    <CardDescription>
                      Dataset row, version row, publication, certificate output, and replay posture returned by the submit flow.
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
                      Raw response returned by the dataset anchor submit route.
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
                    placeholder="Paste dataset receipt JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Bundle JSON</label>
                  <textarea
                    value={form.verifyBundleText}
                    onChange={(e) => updateForm("verifyBundleText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste dataset bundle JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Root directory</label>
                  <input
                    type="text"
                    value={form.verifyRootDir}
                    onChange={(e) => updateForm("verifyRootDir", e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="/absolute/path/to/local/dataset/root"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={busyAction === "verify"}
                    onClick={() => void handleVerify()}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {busyAction === "verify" ? "Verifying..." : "Run verify"}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-base">Verify guidance</CardTitle>
                    <CardDescription>
                      Re-check the returned receipt and bundle, and optionally compare against local source material.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div>
                      <div className="font-semibold text-foreground/90">Receipt verify</div>
                      <div>Checks structural and deterministic integrity of the dataset anchor receipt.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Bundle verify</div>
                      <div>Checks the dataset bundle, digests, and Merkle-backed structure.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Local verify</div>
                      <div>Optionally compares the source directory against the supplied receipt or bundle.</div>
                    </div>
                  </CardContent>
                </Card>

                {verifyResult ? <VerifyResultCards verifyResult={verifyResult} /> : null}
              </div>
            </div>

            {verifyResult ? (
              <Card className="border-border/60 bg-card/25">
                <CardHeader>
                  <CardTitle className="text-base">Verify response</CardTitle>
                  <CardDescription>
                    Raw response returned by the dataset verify route.
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