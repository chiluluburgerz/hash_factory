import React from "react";
import {
  FlaskConical,
  RefreshCw,
  ShieldCheck,
  ScrollText,
  Database,
  FolderTree,
  FileJson,
  FileText,
  File,
  CheckCircle2,
  AlertTriangle,
  Play,
  Search,
  Layers3,
  Upload,
  Copy,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import JsonBlock from "@/components/entities/json-block.jsx";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import HashscanButton from "@/components/hcs/hashscan-button.jsx";
import { HcsTxLabel } from "@/components/hcs/hcs-tx-link.jsx";
import MirrorStatusPill from "@/components/hcs/mirror-status-pill.jsx";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shortHash(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
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

function parseJsonObjectInput(raw, emptyValue = null) {
  const text = String(raw || "").trim();
  if (!text) return emptyValue;

  const parsed = JSON.parse(text);
  if (!isPlainObject(parsed)) {
    throw new Error("JSON input must be a JSON object.");
  }
  return parsed;
}

function parseJsonAnyInput(raw, emptyValue = null) {
  const text = String(raw || "").trim();
  if (!text) return emptyValue;
  return JSON.parse(text);
}

function buildMaterialFromForm(kind, form) {
  switch (kind) {
    case "json":
      return {
        kind: "json",
        value: parseJsonAnyInput(form.jsonValue, {}),
      };

    case "text":
      return {
        kind: "text",
        text: String(form.textValue || ""),
        ...(String(form.textMediaType || "").trim()
          ? { media_type: String(form.textMediaType).trim() }
          : {}),
      };

    case "file":
      return {
        kind: "file",
        path: String(form.filePath || "").trim(),
      };

    case "file_set":
      return {
        kind: "file_set",
        root_dir: String(form.rootDir || "").trim(),
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: Boolean(form.followSymlinks),
          redact_paths: Boolean(form.redactPaths),
          normalize_line_endings: Boolean(form.normalizeLineEndings),
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
      };

    default:
      throw new Error(`Unsupported material kind: ${String(kind)}`);
  }
}

function buildExecuteBody(mode, form) {
  const identity = {
    object_key: String(form.objectKey || "").trim(),
    object_kind: String(form.objectKind || "").trim(),
    ...(String(form.versionLabel || "").trim()
      ? { version_label: String(form.versionLabel).trim() }
      : {}),
    ...(String(form.program || "").trim()
      ? { program: String(form.program).trim() }
      : {}),
  };

  const material = buildMaterialFromForm(form.materialKind, form);
  const metadata = parseJsonObjectInput(form.metadataText, null);

  return {
    mode,
    identity,
    material,
    ...(String(form.domain || "").trim() ? { domain: String(form.domain).trim() } : {}),
    ...(String(form.proofDate || "").trim() ? { proof_date: String(form.proofDate).trim() } : {}),
    ...(String(form.evidencePointer || "").trim()
      ? { evidence_pointer: String(form.evidencePointer).trim() }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
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

function executeButtonLabel(mode) {
  return mode === "register_and_anchor" ? "Register and anchor" : "Run local ingest";
}

function executeButtonHint(mode) {
  if (mode === "register_and_anchor") {
    return "Create deterministic evidence in Hash Factory, anchor the receipt, build and publish the tenant root, then request trusted root anchoring.";
  }
  if (mode === "merkle_only") {
    return "Create deterministic evidence and Merkle output inside Hash Factory without Core publication.";
  }
  return "Create deterministic evidence and bundle output inside Hash Factory without anchor side effects.";
}

function canExecuteMode(mode, posture) {
  if (!posture?.canUseIngest) return false;
  if (mode === "register_and_anchor") return Boolean(posture?.canRegisterAndAnchor);
  return true;
}

function validateFormForMode(form, mode) {
  const objectKey = String(form.objectKey || "").trim();
  const objectKind = String(form.objectKind || "").trim();
  const domain = String(form.domain || "").trim();
  const proofDate = String(form.proofDate || "").trim();

  if (!objectKey) throw new Error("Object key is required.");
  if (!objectKind) throw new Error("Object kind is required.");

  if (mode === "register_and_anchor") {
    if (!domain) throw new Error("Domain is required for register_and_anchor.");
    if (!proofDate) throw new Error("Proof date is required for register_and_anchor.");
  }

  if (form.materialKind === "file" && !String(form.filePath || "").trim()) {
    throw new Error("File path is required for file material.");
  }

  if (form.materialKind === "file_set" && !String(form.rootDir || "").trim()) {
    throw new Error("Root directory is required for file_set material.");
  }

  if (form.materialKind === "text" && !String(form.textValue || "").length) {
    throw new Error("Text value is required for text material.");
  }

  if (form.materialKind === "json") {
    parseJsonAnyInput(form.jsonValue, {});
  }

  parseJsonObjectInput(form.metadataText, null);
}

function getLatestEvidence(executeResult) {
  return executeResult?.result?.evidence ?? executeResult?.evidence ?? null;
}

function getLatestReceipt(executeResult) {
  return executeResult?.result?.receipt ?? executeResult?.receipt ?? null;
}

function getLatestBundle(executeResult) {
  return executeResult?.result?.evidence?.bundle ?? executeResult?.evidence?.bundle ?? null;
}

function getLatestCore(executeResult) {
  return executeResult?.result?.core ?? executeResult?.core ?? null;
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

function summarizeTrust(core) {
  return {
    receiptAnchored: Boolean(core?.receipt_anchor?.anchor?.id),
    rootPublished: Boolean(
      core?.root_publish?.publish?.hcs_transaction_id ||
      core?.root_publish?.publish?.message_id ||
      core?.root_publish?.status === "published"
    ),
    rootAnchored: Boolean(core?.root_anchor?.anchor?.id),
    certificateIssued: Boolean(core?.root_anchor?.certificate?.issued),
    certificateSkipped: Boolean(core?.receipt_anchor?.certificate?.skipped),
  };
}

function openSingleFilePicker(accept = "*/*") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

async function readFileAsText(file) {
  return await file.text();
}

function ModeBadge({ mode }) {
  const variant =
    mode === "register_and_anchor"
      ? "success"
      : mode === "merkle_only"
        ? "info"
        : "outline";

  return <Badge variant={variant}>{mode || "—"}</Badge>;
}

function MaterialBadge({ kind }) {
  return <Badge variant="outline">{kind || "unknown"}</Badge>;
}

function IngestResultOverview({ result }) {
  const root = result?.result ?? result ?? null;
  const evidence = root?.evidence ?? null;
  const receipt = root?.receipt ?? null;
  const core = root?.core ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <EntitySummaryCard
        title="Mode"
        value={String(root?.mode || "—")}
        hint="Execution mode requested by the actor."
        icon={FlaskConical}
      />
      <EntitySummaryCard
        title="Fingerprint"
        value={shortHash(evidence?.fingerprint)}
        hint="Deterministic digest representing the resulting ingest bundle."
        icon={ShieldCheck}
      />
      <EntitySummaryCard
        title="Bundle digest"
        value={shortHash(evidence?.bundle_digest)}
        hint="Digest of the emitted ingest bundle."
        icon={Layers3}
      />
      <EntitySummaryCard
        title="Receipt"
        value={receipt?.receipt_id ? "Created" : "—"}
        hint={receipt?.receipt_id ? shortHash(receipt.receipt_id) : "No receipt returned"}
        icon={ScrollText}
      />

      {core?.receipt_anchor ? (
        <EntitySummaryCard
          title="Receipt anchor"
          value={String(core?.receipt_anchor?.anchor?.status || core?.receipt_anchor?.anchor?.anchor_kind || "ok")}
          hint={shortHash(core?.receipt_anchor?.anchor?.id || core?.receipt_anchor?.anchor?.anchor_hash)}
          icon={Database}
        />
      ) : null}

      {core?.root_publish ? (
        <EntitySummaryCard
          title="Root publish"
          value={String(core?.root_publish?.status || core?.root_publish?.anchor_status || "ok")}
          hint={shortHash(core?.root_publish?.root_hash)}
          icon={FolderTree}
        />
      ) : null}

      {core?.root_anchor ? (
        <EntitySummaryCard
          title="Root anchor"
          value={String(core?.root_anchor?.anchor?.status || core?.root_anchor?.anchor?.anchor_kind || "ok")}
          hint={shortHash(core?.root_anchor?.anchor?.id || core?.root_anchor?.anchor?.anchor_hash)}
          icon={CheckCircle2}
        />
      ) : null}
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

function TrustSummaryCard({ core }) {
  const summary = summarizeTrust(core);

  return (
    <Card className="border-border/60 bg-card/25">
      <CardHeader>
        <CardTitle className="text-base">Trust summary</CardTitle>
        <CardDescription>
          Quick outcome view for the current ingest run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Receipt anchor</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.receiptAnchored ? "Created" : "Not present"}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Root publish</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.rootPublished ? "Published" : "Not present"}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Root anchor</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.rootAnchored ? "Anchored" : "Not present"}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Certificate</div>
            <div className="mt-1 font-semibold text-foreground/90">
              {summary.certificateIssued
                ? "Issued"
                : summary.certificateSkipped
                  ? "Skipped"
                  : "Pending / none"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HcsActionRow({
  title,
  transactionId,
  messageId,
  verified = false,
  loading = false,
}) {
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

export default function IngestPage() {
  const {
    org,
    user,
    membership,
    entitlements,
    refreshAppContext,
  } = useAppContext();

  const posture = React.useMemo(
    () => deriveIngestPosture(entitlements, membership),
    [entitlements, membership]
  );

  const [activePanel, setActivePanel] = React.useState("execute");
  const [busyAction, setBusyAction] = React.useState("");
  const [pageError, setPageError] = React.useState("");
  const [pageNotice, setPageNotice] = React.useState("");
  const [planResult, setPlanResult] = React.useState(null);
  const [executeResult, setExecuteResult] = React.useState(null);
  const [verifyResult, setVerifyResult] = React.useState(null);

  const [form, setForm] = React.useState({
    mode: "register_and_anchor",
    materialKind: "json",

    objectKey: "hf.demo.object",
    objectKind: "dataset",
    versionLabel: "",
    program: "hash_factory",

    domain: org?.id ? `hf:ingest|org:${org.id}` : "",
    proofDate: new Date().toISOString().slice(0, 10),
    evidencePointer: "",

    metadataText: '{\n  "source": "hf-ui"\n}',

    jsonValue: '{\n  "hello": "world",\n  "version": 1\n}',
    textValue: "Example ingest text",
    textMediaType: "text/plain",
    filePath: "",
    rootDir: "",

    followSymlinks: false,
    redactPaths: false,
    normalizeLineEndings: false,

    verifyReceiptText: "",
    verifyBundleText: "",
    verifyRootDir: "",
  });

  React.useEffect(() => {
    if (!String(form.domain || "").trim() && org?.id) {
      setForm((prev) => ({
        ...prev,
        domain: `hf:ingest|org:${org.id}`,
      }));
    }
  }, [org?.id, form.domain]);

  function updateForm(field, value) {
    setPageError("");
    setPageNotice("");
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function applyModeGuard(nextMode) {
    if (nextMode === "register_and_anchor" && !posture.canRegisterAndAnchor) {
      setPageError("register_and_anchor requires ingest access and tenant-admin or system-admin posture.");
      return;
    }
    updateForm("mode", nextMode);
  }

  async function handleLoadJsonFile() {
    try {
      const file = await openSingleFilePicker(".json,application/json");
      if (!file) return;
      const text = await readFileAsText(file);
      JSON.parse(text);

      setForm((prev) => ({
        ...prev,
        jsonValue: text,
        objectKey: String(prev.objectKey || "").trim() || file.name.replace(/\.json$/i, ""),
      }));

      setPageError("");
      setPageNotice("Loaded JSON file into the ingest form.");
    } catch {
      setPageError("Failed to load JSON file.");
    }
  }

  async function handleLoadTextFile() {
    try {
      const file = await openSingleFilePicker(".txt,.md,.csv,.log,text/*");
      if (!file) return;
      const text = await readFileAsText(file);

      setForm((prev) => ({
        ...prev,
        textValue: text,
        objectKey: String(prev.objectKey || "").trim() || file.name.replace(/\.[^.]+$/i, ""),
      }));

      setPageError("");
      setPageNotice("Loaded text file into the ingest form.");
    } catch {
      setPageError("Failed to load text file.");
    }
  }

  async function handlePlan() {
    setBusyAction("plan");
    setPageError("");
    setPageNotice("");
    setPlanResult(null);

    try {
      validateFormForMode(form, form.mode);

      const body = buildExecuteBody(form.mode, form);
      const payload = await fetchJsonOrThrow("/v1/ingest/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: body.mode,
          identity: body.identity,
          material: body.material,
          ...(body.domain ? { domain: body.domain } : {}),
          ...(body.proof_date ? { proof_date: body.proof_date } : {}),
        }),
      });

      setPlanResult(payload);
      setPageNotice("Ingest plan built successfully.");
      setActivePanel("plan");
    } catch (err) {
      setPageError(err?.message || "Failed to build ingest plan.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleExecute(modeOverride = null) {
    const nextMode = modeOverride || form.mode;

    setBusyAction("execute");
    setPageError("");
    setPageNotice("");
    setExecuteResult(null);

    try {
      if (!canExecuteMode(nextMode, posture)) {
        throw new Error(
          nextMode === "register_and_anchor"
            ? "register_and_anchor requires tenant-admin or system-admin posture."
            : "Your current tenant context does not allow ingest."
        );
      }

      validateFormForMode(form, nextMode);

      const body = buildExecuteBody(nextMode, form);

      const payload = await fetchJsonOrThrow("/v1/ingest/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      setExecuteResult(payload);
      setPageNotice(
        nextMode === "register_and_anchor"
          ? "Anchored ingest completed."
          : "Local ingest execution completed."
      );
      setActivePanel("execute");
    } catch (err) {
      setPageError(err?.message || "Failed to execute ingest.");
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(receipt ? { receipt } : {}),
          ...(bundle ? { bundle } : {}),
          ...(rootDir ? { root_dir: rootDir } : {}),
        }),
      });

      setVerifyResult(payload);
      setPageNotice("Verification completed.");
      setActivePanel("verify");
    } catch (err) {
      setPageError(err?.message || "Failed to verify ingest artifacts.");
    } finally {
      setBusyAction("");
    }
  }

  const currentMaterialIcon =
    form.materialKind === "json"
      ? FileJson
      : form.materialKind === "text"
        ? FileText
        : form.materialKind === "file"
          ? File
          : FolderTree;

  const CurrentMaterialIcon = currentMaterialIcon;

  const evidence = getLatestEvidence(executeResult);
  const receipt = getLatestReceipt(executeResult);
  const core = getLatestCore(executeResult);

  const modeOptions = [
    {
      value: "hash_only",
      label: "Hash only",
      hint: "Generate deterministic evidence without anchor side effects.",
    },
    {
      value: "merkle_only",
      label: "Merkle only",
      hint: "Generate local bundle plus Merkle output without Core publication.",
    },
    {
      value: "register_and_anchor",
      label: "Register and anchor",
      hint: "Run the full trusted HF flow with receipt and root anchoring.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Ingest
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Compose deterministic ingest requests, preview the execution plan, generate evidence inside Hash Factory,
            and optionally register anchored trust outputs into Vera Anchor.
          </p>
        </div>

        <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reload context
        </Button>
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
          title="Ingest access"
          value={posture.canUseIngest ? "Enabled" : "Restricted"}
          hint="Whether this actor can run ingest workflows."
          icon={FlaskConical}
        />
        <EntitySummaryCard
          title="Anchor mode"
          value={posture.canRegisterAndAnchor ? "Available" : "Limited"}
          hint="register_and_anchor requires elevated admin posture."
          icon={ShieldCheck}
        />
        <EntitySummaryCard
          title="Org"
          value={org?.name || "No org"}
          hint={org?.id || "No current org context"}
          icon={Database}
        />
        <EntitySummaryCard
          title="Actor"
          value={user?.displayName || user?.email || "Authenticated user"}
          hint={`role ${membership?.role || "unknown"}`}
          icon={ScrollText}
        />
      </div>

      <EntitySection
        title="Current ingest posture"
        description="This page composes deterministic HF-side evidence generation with optional Core side effects."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FlaskConical className="h-4 w-4" />
              HF-side deterministic execution
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The ingest pipeline builds deterministic evidence, bundle digests, fingerprints, and receipt material
              inside Hash Factory before any anchor side effects occur.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Trusted anchor path
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              In register_and_anchor mode, the UI requests receipt anchoring plus trusted HF root build,
              root publish, and root anchor steps in deterministic order.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Search className="h-4 w-4" />
              Verification-ready output
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Returned evidence, receipt, and bundle artifacts can immediately feed the verify route for local
              re-check and demo review.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={posture.canUseIngest ? "success" : "warn"}>
            ingest {posture.canUseIngest ? "enabled" : "restricted"}
          </Badge>
          <Badge variant={posture.canRegisterAndAnchor ? "success" : "warn"}>
            register_and_anchor {posture.canRegisterAndAnchor ? "available" : "limited"}
          </Badge>
          <Badge variant={posture.canMintCertificates ? "success" : "outline"}>
            certificates {posture.canMintCertificates ? "eligible" : "not eligible"}
          </Badge>
          <Badge variant={posture.isTenantAdmin ? "success" : "outline"}>
            role {membership?.role || "unknown"}
          </Badge>
        </div>
      </EntitySection>

      <EntitySection
        title="Compose ingest request"
        description="Define identity, source material, anchor domain, and execution mode."
      >
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Mode</label>
                <div className="grid gap-2">
                  {modeOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => applyModeGuard(item.value)}
                      className={[
                        "rounded-2xl border px-4 py-3 text-left transition",
                        form.mode === item.value
                          ? "border-border/80 bg-card/50"
                          : "border-border/60 bg-card/20 hover:bg-card/30",
                      ].join(" ")}
                    >
                      <div className="text-sm font-semibold text-foreground/90">{item.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.hint}</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  register_and_anchor performs Core side effects and requires elevated actor posture.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Material kind</label>
                <div className="flex flex-wrap gap-2">
                  {["json", "text", "file", "file_set"].map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={form.materialKind === value ? "default" : "outline"}
                      onClick={() => updateForm("materialKind", value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Choose the source material Hash Factory will normalize and hash.
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Object key</label>
                <input
                  type="text"
                  value={form.objectKey}
                  onChange={(e) => updateForm("objectKey", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="hf.dataset.raw-001"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Object kind</label>
                <input
                  type="text"
                  value={form.objectKind}
                  onChange={(e) => updateForm("objectKind", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="dataset"
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
                <label className="text-sm font-medium text-foreground/90">Program</label>
                <input
                  type="text"
                  value={form.program}
                  onChange={(e) => updateForm("program", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="hash_factory"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Domain</label>
                <input
                  type="text"
                  value={form.domain}
                  onChange={(e) => updateForm("domain", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                  placeholder="hf:ingest|org:..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Proof date</label>
                <input
                  type="date"
                  value={form.proofDate}
                  onChange={(e) => updateForm("proofDate", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                />
              </div>

              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium text-foreground/90">Evidence pointer</label>
                <input
                  type="text"
                  value={form.evidencePointer}
                  onChange={(e) => updateForm("evidencePointer", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  placeholder="Optional durable pointer to stored local evidence"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground/90">
                <CurrentMaterialIcon className="h-4 w-4" />
                Material input
              </div>

              {form.materialKind === "json" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleLoadJsonFile()}>
                      <Upload className="mr-2 h-4 w-4" />
                      Load JSON file
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">JSON value</label>
                    <textarea
                      value={form.jsonValue}
                      onChange={(e) => updateForm("jsonValue", e.target.value)}
                      className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                      placeholder='{"hello":"world"}'
                    />
                  </div>
                </div>
              ) : null}

              {form.materialKind === "text" ? (
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleLoadTextFile()}>
                      <Upload className="mr-2 h-4 w-4" />
                      Load text file
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Text value</label>
                    <textarea
                      value={form.textValue}
                      onChange={(e) => updateForm("textValue", e.target.value)}
                      className="min-h-40 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="Paste text content to normalize and hash"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Media type</label>
                    <input
                      type="text"
                      value={form.textMediaType}
                      onChange={(e) => updateForm("textMediaType", e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="text/plain"
                    />
                  </div>
                </div>
              ) : null}

              {form.materialKind === "file" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">File path</label>
                  <input
                    type="text"
                    value={form.filePath}
                    onChange={(e) => updateForm("filePath", e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="/absolute/path/to/file"
                  />
                  <p className="text-xs text-muted-foreground">
                    Uses authenticated local file access on the HF host. This mode references a server-side path, not a browser-selected file.
                  </p>
                </div>
              ) : null}

              {form.materialKind === "file_set" ? (
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Root directory</label>
                    <input
                      type="text"
                      value={form.rootDir}
                      onChange={(e) => updateForm("rootDir", e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                      placeholder="/absolute/path/to/directory"
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
                      <input
                        type="checkbox"
                        checked={Boolean(form.followSymlinks)}
                        onChange={(e) => updateForm("followSymlinks", e.target.checked)}
                      />
                      Follow symlinks
                    </label>

                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
                      <input
                        type="checkbox"
                        checked={Boolean(form.redactPaths)}
                        onChange={(e) => updateForm("redactPaths", e.target.checked)}
                      />
                      Redact paths
                    </label>

                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
                      <input
                        type="checkbox"
                        checked={Boolean(form.normalizeLineEndings)}
                        onChange={(e) => updateForm("normalizeLineEndings", e.target.checked)}
                      />
                      Normalize line endings
                    </label>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    file_set references an HF host directory and produces deterministic bundle plus Merkle evidence across the scanned file set.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">Metadata JSON</label>
              <textarea
                value={form.metadataText}
                onChange={(e) => updateForm("metadataText", e.target.value)}
                className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                placeholder='{"source":"hf-ui"}'
              />
            </div>
          </div>

          <div className="space-y-4">
            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Request summary</CardTitle>
                <CardDescription>
                  Quick review before preview or execution.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Mode</span>
                  <ModeBadge mode={form.mode} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Material</span>
                  <MaterialBadge kind={form.materialKind} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Object key</span>
                  <span className="font-mono text-xs text-foreground/90">{form.objectKey || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Domain</span>
                  <span className="font-mono text-xs text-foreground/90">{form.domain || "—"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Proof date</span>
                  <span className="text-foreground/90">{form.proofDate || "—"}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
                <CardDescription>
                  Preview the deterministic plan first, then run the exact workflow you want.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="text-sm font-semibold text-foreground/90">
                    {executeButtonLabel(form.mode)}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {executeButtonHint(form.mode)}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busyAction)}
                    onClick={() => void handlePlan()}
                  >
                    <Layers3 className="mr-2 h-4 w-4" />
                    {busyAction === "plan" ? "Previewing..." : "Preview plan"}
                  </Button>

                  <Button
                    type="button"
                    disabled={Boolean(busyAction) || !canExecuteMode(form.mode, posture)}
                    onClick={() => void handleExecute()}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {busyAction === "execute" ? "Working..." : executeButtonLabel(form.mode)}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyAction === "verify"}
                    onClick={() => setActivePanel("verify")}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Open verify panel
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/35 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Operational notes</CardTitle>
                <CardDescription>
                  Expected behavior for each mode.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div>
                  <div className="font-semibold text-foreground/90">Hash only</div>
                  <div>Builds deterministic evidence and bundle outputs inside Hash Factory without anchor side effects.</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground/90">Merkle only</div>
                  <div>Builds local bundle and Merkle evidence inside Hash Factory without Core publication.</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground/90">Register and anchor</div>
                  <div>Anchors receipt JSON, builds and publishes a tenant root, then requests trusted HF root anchor.</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </EntitySection>

      <EntitySection
        title="Result workspace"
        description="Review preview output, execution output, or verify artifacts."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "plan", label: "Preview" },
            { key: "execute", label: "Result" },
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

        {activePanel === "plan" ? (
          <div className="space-y-4">
            {!planResult ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
                No plan has been generated yet.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busyAction) || !posture.canUseIngest}
                    onClick={() => void handleExecute("merkle_only")}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Run local ingest
                  </Button>

                  <Button
                    type="button"
                    disabled={Boolean(busyAction) || !posture.canRegisterAndAnchor}
                    onClick={() => void handleExecute("register_and_anchor")}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Register and anchor
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <SummaryCard
                    icon={Layers3}
                    title="Plan id"
                    value={shortHash(planResult?.result?.plan_id)}
                    hint="Deterministic plan identifier for the current request shape."
                  />
                  <SummaryCard
                    icon={Database}
                    title="Object key"
                    value={String(planResult?.result?.object_key || "—")}
                    hint="Bound object identity for this plan."
                  />
                  <SummaryCard
                    icon={FolderTree}
                    title="Steps"
                    value={String((planResult?.result?.steps || []).length || 0)}
                    hint={Array.isArray(planResult?.result?.steps) ? planResult.result.steps.join(" → ") : "—"}
                  />
                </div>

                <JsonBlock value={planResult?.result ?? planResult} emptyLabel="No plan result" />
              </>
            )}
          </div>
        ) : null}

        {activePanel === "execute" ? (
          <div className="space-y-4">
            {!executeResult ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
                No ingest execution has been run yet.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const latestReceipt = getLatestReceipt(executeResult);
                      const latestBundle = getLatestBundle(executeResult);

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
                      void copyJson(getLatestReceipt(executeResult), "Receipt", setPageNotice, setPageError)
                    }
                  >
                    <ScrollText className="mr-2 h-4 w-4" />
                    Copy receipt
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void copyJson(getLatestBundle(executeResult), "Bundle", setPageNotice, setPageError)
                    }
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy bundle
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busyAction)}
                    onClick={() => void handleExecute()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Run again
                  </Button>
                </div>

                <IngestResultOverview result={executeResult} />
                <TrustSummaryCard core={core} />

                <div className="grid gap-4 xl:grid-cols-3">
                  <HcsActionRow
                    title="Receipt anchor transaction"
                    transactionId={core?.receipt_anchor?.anchor?.hcs_transaction_id}
                    messageId={core?.receipt_anchor?.anchor?.hcs_message_id}
                    verified={Boolean(core?.receipt_anchor?.anchor?.confirmed_at)}
                  />

                  <HcsActionRow
                    title="Root publish transaction"
                    transactionId={core?.root_publish?.publish?.hcs_transaction_id}
                    messageId={core?.root_publish?.publish?.message_id}
                    verified={Boolean(core?.root_publish?.mirror_verified)}
                  />

                  <HcsActionRow
                    title="Root anchor transaction"
                    transactionId={core?.root_anchor?.anchor?.hcs_transaction_id}
                    messageId={core?.root_anchor?.anchor?.hcs_message_id}
                    verified={Boolean(core?.root_anchor?.anchor?.confirmed_at)}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Evidence</CardTitle>
                      <CardDescription>
                        Deterministic evidence emitted from Hash Factory execution.
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
                        The returned ingest receipt, including optional core anchor enrichment.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={receipt} emptyLabel="No receipt" />
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Core side effects</CardTitle>
                    <CardDescription>
                      Receipt anchor, root build, root publish, and root anchor output when applicable.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={core} emptyLabel="No core side effects returned" />
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Full execute response</CardTitle>
                    <CardDescription>
                      Raw response returned by the HF ingest execute route.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={executeResult?.result ?? executeResult} emptyLabel="No execute response" />
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
                    onClick={() => {
                      const latestReceipt = getLatestReceipt(executeResult);
                      if (!latestReceipt) return;

                      setForm((prev) => ({
                        ...prev,
                        verifyReceiptText: JSON.stringify(latestReceipt, null, 2),
                      }));
                      setPageNotice("Loaded latest receipt into verify input.");
                      setPageError("");
                    }}
                    disabled={!getLatestReceipt(executeResult)}
                  >
                    Use latest receipt
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const latestBundle = getLatestBundle(executeResult);
                      if (!latestBundle) return;

                      setForm((prev) => ({
                        ...prev,
                        verifyBundleText: JSON.stringify(latestBundle, null, 2),
                      }));
                      setPageNotice("Loaded latest bundle into verify input.");
                      setPageError("");
                    }}
                    disabled={!getLatestBundle(executeResult)}
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
                    placeholder="/absolute/path/to/local/root_dir"
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
                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-base">Verify guidance</CardTitle>
                    <CardDescription>
                      Use this panel to re-check returned artifacts and optionally compare against a local directory.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div>
                      <div className="font-semibold text-foreground/90">Receipt verify</div>
                      <div>Checks the structural and deterministic integrity of a returned ingest receipt.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Bundle verify</div>
                      <div>Checks bundle consistency and digest-backed structure.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Local verify</div>
                      <div>Optionally compares a directory against the supplied receipt or bundle.</div>
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

      <EntitySection
        title="High-leverage workflow guidance"
        description="A clean first UX should make the core trust path obvious."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FileJson className="h-4 w-4" />
              Start with JSON or text
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              These inputs are easiest for early demoability because they avoid host-path friction while still
              exercising deterministic receipt creation and anchor flows.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FolderTree className="h-4 w-4" />
              Promote to file_set next
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              file_set is the real trust surface for bundle and Merkle evidence. Keep the rules explicit and
              visible so users understand exactly what is being normalized and hashed.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <AlertTriangle className="h-4 w-4" />
              Keep anchor intent explicit
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Users should always understand when they are generating HF-side evidence only versus requesting
              anchored tenant-side trust effects into the broader Vera Anchor system.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}