import React from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  ShieldCheck,
  ScrollText,
  FolderTree,
  Layers3,
  Search,
  LockKeyhole,
  Radio,
  Database,
  FlaskConical,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function boolish(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function normalizeObjectEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return root && typeof root === "object" && !Array.isArray(root) ? root : {};
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
    return v.ok
      ? "Verification succeeded."
      : `Detected ${Array.isArray(v?.mismatches) ? v.mismatches.length : 0} mismatch${Array.isArray(v?.mismatches) && v.mismatches.length === 1 ? "" : "es"}.`;
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

function MismatchList({ verifyResult }) {
  const root = verifyResult?.result ?? verifyResult ?? null;

  const groups = [
    {
      key: "receipt_verify",
      label: "Receipt mismatches",
      items: Array.isArray(root?.receipt_verify?.mismatches) ? root.receipt_verify.mismatches : [],
    },
    {
      key: "bundle_verify",
      label: "Bundle mismatches",
      items: Array.isArray(root?.bundle_verify?.mismatches) ? root.bundle_verify.mismatches : [],
    },
    {
      key: "local_verify",
      label: "Local mismatches",
      items: Array.isArray(root?.local_verify?.mismatches) ? root.local_verify.mismatches : [],
    },
  ].filter((group) => group.items.length > 0);

  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
        No mismatches were reported by the selected verification workflow.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.key} className="border-border/60 bg-card/25">
          <CardHeader>
            <CardTitle className="text-base">{group.label}</CardTitle>
            <CardDescription>
              Deterministic comparison fields that did not match.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            {group.items.map((item, index) => (
              <div
                key={`${group.key}-${index}`}
                className="rounded-xl border border-border/60 bg-background/30 p-4"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {item?.field || "field"}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Expected
                    </div>
                    <pre className="overflow-x-auto rounded-lg border border-border/60 bg-card/25 p-3 text-xs leading-6 text-foreground/90 whitespace-pre-wrap break-all">
                      {JSON.stringify(item?.expected ?? null, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Actual
                    </div>
                    <pre className="overflow-x-auto rounded-lg border border-border/60 bg-card/25 p-3 text-xs leading-6 text-foreground/90 whitespace-pre-wrap break-all">
                      {JSON.stringify(item?.actual ?? null, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ComputedValuesCard({ title, value }) {
  return (
    <Card className="border-border/60 bg-card/25">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Deterministically recomputed values returned by the verification routine.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <JsonBlock value={value} emptyLabel="No computed values returned" />
      </CardContent>
    </Card>
  );
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
  return firstDefined(
    result?.decrypted,
    result?.decrypted_payload,
    result?.plaintext,
    result?.cleartext,
    result?.payload_json,
    result?.payload
  );
}

function deriveOverallVerifyState(verifyResult) {
  const root = verifyResult?.result ?? verifyResult ?? null;
  if (!root) return null;

  const checks = [
    root?.receipt_verify?.ok,
    root?.bundle_verify?.ok,
    root?.local_verify?.ok,
  ].filter((v) => typeof v === "boolean");

  if (!checks.length) return null;
  return checks.every(Boolean);
}

function buildHederaPayload({ identifierType, identifierValue, mode, includeDecrypted }) {
  const normalized = String(identifierValue || "").trim();
  if (!normalized) return null;

  const out = {};

  if (identifierType === "transaction_id") {
    out.transaction_id = normalized;
  } else {
    out.message_id = normalized;
  }

  if (mode === "verify_only") {
    out.mode = "verify_only";
    out.include_decrypted = false;
    return out;
  }

  if (mode === "decrypt_only") {
    out.mode = "decrypt_only";
    return out;
  }

  out.mode = "decrypt_and_verify";
  out.include_decrypted = Boolean(includeDecrypted);
  return out;
}

function deriveHederaActionPath(mode) {
  if (mode === "verify_only") return "/v1/hedera/verify";
  if (mode === "decrypt_only") return "/v1/hedera/decrypt";
  return "/v1/hedera/decrypt/verify";
}

function deriveHederaActionLabel(mode) {
  if (mode === "verify_only") return "Run verify";
  if (mode === "decrypt_only") return "Run decrypt";
  return "Run decrypt & verify";
}

export default function VerifyPage() {
  const { org, user, membership, refreshAppContext, isLoading: appLoading } = useAppContext();

  const [activeSurface, setActiveSurface] = React.useState("ingest");
  const [busyAction, setBusyAction] = React.useState("");
  const [pageError, setPageError] = React.useState("");
  const [pageNotice, setPageNotice] = React.useState("");

  const [ingestForm, setIngestForm] = React.useState({
    receiptText: "",
    bundleText: "",
    rootDir: "",
  });
  const [datasetForm, setDatasetForm] = React.useState({
    receiptText: "",
    bundleText: "",
    rootDir: "",
  });
  const [hederaForm, setHederaForm] = React.useState({
    identifierType: "message_id",
    identifierValue: "",
    mode: "decrypt_and_verify",
    includeDecrypted: true,
  });

  const [ingestResult, setIngestResult] = React.useState(null);
  const [datasetResult, setDatasetResult] = React.useState(null);
  const [hederaResult, setHederaResult] = React.useState(null);

  function clearFeedback() {
    setPageError("");
    setPageNotice("");
  }

  function updateIngest(field, value) {
    clearFeedback();
    setIngestForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateDataset(field, value) {
    clearFeedback();
    setDatasetForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateHedera(field, value) {
    clearFeedback();
    setHederaForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleRunIngestVerify() {
    setBusyAction("ingest");
    setPageError("");
    setPageNotice("");
    setIngestResult(null);

    try {
      const receipt = parseJsonAnyInput(ingestForm.receiptText, null);
      const bundle = parseJsonAnyInput(ingestForm.bundleText, null);
      const rootDir = String(ingestForm.rootDir || "").trim() || null;

      if (!receipt && !bundle && !rootDir) {
        throw new Error("Provide at least one ingest verification input: receipt, bundle, or root directory.");
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

      setIngestResult(payload);
      setPageNotice("Ingest verification completed.");
      setActiveSurface("ingest");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
          err?.payload?.message ||
          err?.message ||
          "Failed to verify ingest artifacts."
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleRunDatasetVerify() {
    setBusyAction("dataset");
    setPageError("");
    setPageNotice("");
    setDatasetResult(null);

    try {
      const receipt = parseJsonAnyInput(datasetForm.receiptText, null);
      const bundle = parseJsonAnyInput(datasetForm.bundleText, null);
      const rootDir = String(datasetForm.rootDir || "").trim() || null;

      if (!receipt && !bundle && !rootDir) {
        throw new Error("Provide at least one dataset verification input: receipt, bundle, or root directory.");
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

      setDatasetResult(payload);
      setPageNotice("Dataset verification completed.");
      setActiveSurface("dataset");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
          err?.payload?.message ||
          err?.message ||
          "Failed to verify dataset artifacts."
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleRunHederaVerify() {
    setBusyAction("hedera");
    setPageError("");
    setPageNotice("");
    setHederaResult(null);

    try {
      const identifierValue = String(hederaForm.identifierValue || "").trim();
      if (!identifierValue) {
        throw new Error("Provide a Hedera message id or transaction id.");
      }

      const payloadBody = buildHederaPayload({
        identifierType: hederaForm.identifierType,
        identifierValue,
        mode: hederaForm.mode,
        includeDecrypted: hederaForm.includeDecrypted,
      });

      const payload = await fetchJsonOrThrow(deriveHederaActionPath(hederaForm.mode), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      });

      setHederaResult(payload);
      setPageNotice(
        hederaForm.mode === "verify_only"
          ? "Hedera verification completed."
          : hederaForm.mode === "decrypt_only"
            ? "Hedera decrypt completed."
            : "Hedera decrypt and verify completed."
      );
      setActiveSurface("hedera");
    } catch (err) {
      setPageError(
        err?.payload?.detail?.message ||
          err?.payload?.message ||
          err?.message ||
          "Failed to run Hedera verification workflow."
      );
    } finally {
      setBusyAction("");
    }
  }

  const ingestOverallOk = deriveOverallVerifyState(ingestResult);
  const datasetOverallOk = deriveOverallVerifyState(datasetResult);
  const hederaEnvelope = normalizeObjectEnvelope(hederaResult);
  const hederaVerifyState = resolvedVerifyState(hederaEnvelope);
  const hederaDecryptedPayload = resolvedDecryptedPayload(hederaEnvelope);

  const orgRole = membership?.role || "unknown";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app" className="hover:underline">
              Workspace
            </Link>
            <span className="mx-2">/</span>
            <span>Verification</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Verification
          </h1>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Validate receipts, bundles, local material, and protected Hedera records through one operator-facing trust workbench. Use this page to confirm deterministic integrity after ingest, dataset anchoring, or Hedera publication workflows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload context
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/hedera/decrypt">
              <LockKeyhole className="mr-2 h-4 w-4" />
              Open Hedera decrypt page
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
          title="Organization"
          value={appLoading ? "Loading..." : org?.name || "No org"}
          hint={org?.id || "No current org context"}
          icon={Database}
        />
        <EntitySummaryCard
          title="Actor"
          value={user?.displayName || user?.email || "Authenticated user"}
          hint={`role ${orgRole}`}
          icon={ShieldCheck}
        />
        <EntitySummaryCard
          title="Ingest verify"
          value={ingestOverallOk == null ? "Ready" : ingestOverallOk ? "Passed" : "Failed"}
          hint="Receipt, bundle, and optional local file-set validation."
          icon={FlaskConical}
        />
        <EntitySummaryCard
          title="Dataset / Hedera"
          value={
            datasetOverallOk === false || hederaVerifyState === false
              ? "Attention"
              : datasetOverallOk === true || hederaVerifyState === true
                ? "Verified"
                : "Ready"
          }
          hint="Dataset artifact validation plus protected Hedera proof inspection."
          icon={LockKeyhole}
        />
      </div>

      <EntitySection
        title="Verification posture"
        description="This page is the trust confirmation layer of Hash Factory. It does not create new artifacts; it validates existing ones and surfaces mismatches clearly."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FlaskConical className="h-4 w-4" />
              Ingest evidence
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Re-check ingest receipts, bundles, and optional local file-set material against the deterministic fingerprints and Merkle outputs generated by Hash Factory.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Database className="h-4 w-4" />
              Dataset evidence
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Confirm dataset receipt integrity, bundle consistency, and local dataset material against the anchored dataset evidence surface.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <LockKeyhole className="h-4 w-4" />
              Protected Hedera records
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Run actor-scoped verify, decrypt, or decrypt-and-verify flows against HCS records without exposing authorization logic in the UI.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="success">single verification workbench</Badge>
          <Badge variant="outline">no new backend routes required</Badge>
          <Badge variant="info">user-facing trust surface</Badge>
          <Badge variant="outline">freeze-safe scope</Badge>
        </div>
      </EntitySection>

      <EntitySection
        title="Verification workbench"
        description="Choose the trust surface you want to inspect, provide the relevant artifacts, and review pass/fail plus deterministic mismatch output."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "ingest", label: "Ingest verify" },
            { key: "dataset", label: "Dataset verify" },
            { key: "hedera", label: "Hedera verify" },
          ].map((item) => (
            <Button
              key={item.key}
              type="button"
              variant={activeSurface === item.key ? "default" : "outline"}
              onClick={() => setActiveSurface(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {activeSurface === "ingest" ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Ingest receipt JSON</label>
                  <textarea
                    value={ingestForm.receiptText}
                    onChange={(e) => updateIngest("receiptText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste ingest receipt JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Ingest bundle JSON</label>
                  <textarea
                    value={ingestForm.bundleText}
                    onChange={(e) => updateIngest("bundleText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste ingest bundle JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Local root directory</label>
                  <Input
                    value={ingestForm.rootDir}
                    onChange={(e) => updateIngest("rootDir", e.target.value)}
                    placeholder="/absolute/path/to/local/root_dir"
                  />
                </div>

                <div className="flex justify-end">
                  <Button type="button" disabled={busyAction === "ingest"} onClick={() => void handleRunIngestVerify()}>
                    <Search className="mr-2 h-4 w-4" />
                    {busyAction === "ingest" ? "Verifying..." : "Run ingest verify"}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-base">Ingest verify guidance</CardTitle>
                    <CardDescription>
                      Use this when validating generic ingest evidence created by Hash Factory.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div>
                      <div className="font-semibold text-foreground/90">Receipt verify</div>
                      <div>Checks receipt structure and recomputed receipt id / idempotency linkage.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Bundle verify</div>
                      <div>Checks bundle digest, fingerprint, item counts, bytes, and optional Merkle structure.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Local verify</div>
                      <div>Optionally compares a local file-set against the supplied receipt or bundle.</div>
                    </div>
                  </CardContent>
                </Card>

                {ingestResult ? <VerifyResultCards verifyResult={ingestResult} /> : null}
              </div>
            </div>

            {ingestResult ? (
              <>
                <MismatchList verifyResult={ingestResult} />

                <div className="grid gap-4 xl:grid-cols-3">
                  <ComputedValuesCard
                    title="Receipt computed values"
                    value={ingestResult?.result?.receipt_verify?.computed}
                  />
                  <ComputedValuesCard
                    title="Bundle computed values"
                    value={ingestResult?.result?.bundle_verify?.computed}
                  />
                  <ComputedValuesCard
                    title="Local computed values"
                    value={ingestResult?.result?.local_verify?.computed}
                  />
                </div>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Raw ingest verify response</CardTitle>
                    <CardDescription>
                      Full response returned by the ingest verify route.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={ingestResult?.result ?? ingestResult} emptyLabel="No verify response" />
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>
        ) : null}

        {activeSurface === "dataset" ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Dataset receipt JSON</label>
                  <textarea
                    value={datasetForm.receiptText}
                    onChange={(e) => updateDataset("receiptText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste dataset receipt JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Dataset bundle JSON</label>
                  <textarea
                    value={datasetForm.bundleText}
                    onChange={(e) => updateDataset("bundleText", e.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                    placeholder="Paste dataset bundle JSON"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Local root directory</label>
                  <Input
                    value={datasetForm.rootDir}
                    onChange={(e) => updateDataset("rootDir", e.target.value)}
                    placeholder="/absolute/path/to/local/dataset/root"
                  />
                </div>

                <div className="flex justify-end">
                  <Button type="button" disabled={busyAction === "dataset"} onClick={() => void handleRunDatasetVerify()}>
                    <Search className="mr-2 h-4 w-4" />
                    {busyAction === "dataset" ? "Verifying..." : "Run dataset verify"}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-base">Dataset verify guidance</CardTitle>
                    <CardDescription>
                      Use this when validating dataset-oriented evidence and registry-facing dataset artifacts.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div>
                      <div className="font-semibold text-foreground/90">Receipt verify</div>
                      <div>Checks receipt id and dataset evidence idempotency linkage.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Bundle verify</div>
                      <div>Checks dataset fingerprint, bundle digest, file counts, bytes, and Merkle root.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Local verify</div>
                      <div>Optionally compares the local dataset root against the supplied receipt or bundle.</div>
                    </div>
                  </CardContent>
                </Card>

                {datasetResult ? <VerifyResultCards verifyResult={datasetResult} /> : null}
              </div>
            </div>

            {datasetResult ? (
              <>
                <MismatchList verifyResult={datasetResult} />

                <div className="grid gap-4 xl:grid-cols-3">
                  <ComputedValuesCard
                    title="Receipt computed values"
                    value={datasetResult?.result?.receipt_verify?.computed}
                  />
                  <ComputedValuesCard
                    title="Bundle computed values"
                    value={datasetResult?.result?.bundle_verify?.computed}
                  />
                  <ComputedValuesCard
                    title="Local computed values"
                    value={datasetResult?.result?.local_verify?.computed}
                  />
                </div>

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Raw dataset verify response</CardTitle>
                    <CardDescription>
                      Full response returned by the dataset verify route.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={datasetResult?.result ?? datasetResult} emptyLabel="No verify response" />
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>
        ) : null}

        {activeSurface === "hedera" ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-3 text-sm text-foreground/90">
                    <input
                      type="radio"
                      name="identifierType"
                      checked={hederaForm.identifierType === "message_id"}
                      onChange={() => updateHedera("identifierType", "message_id")}
                    />
                    <span>Message id</span>
                  </label>

                  <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-3 text-sm text-foreground/90">
                    <input
                      type="radio"
                      name="identifierType"
                      checked={hederaForm.identifierType === "transaction_id"}
                      onChange={() => updateHedera("identifierType", "transaction_id")}
                    />
                    <span>Transaction id</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">
                    {hederaForm.identifierType === "transaction_id" ? "Transaction id" : "Message id"}
                  </label>
                  <Input
                    value={hederaForm.identifierValue}
                    onChange={(e) => updateHedera("identifierValue", e.target.value)}
                    placeholder={
                      hederaForm.identifierType === "transaction_id"
                        ? "Paste a Hedera transaction id"
                        : "Paste a HCS message id"
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Workflow mode</label>
                  <select
                    value={hederaForm.mode}
                    onChange={(e) => updateHedera("mode", e.target.value)}
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
                    checked={Boolean(hederaForm.includeDecrypted)}
                    disabled={hederaForm.mode === "verify_only"}
                    onChange={(e) => updateHedera("includeDecrypted", e.target.checked)}
                  />
                  <span>Include decrypted payload when permitted</span>
                </label>

                <div className="flex justify-end">
                  <Button type="button" disabled={busyAction === "hedera"} onClick={() => void handleRunHederaVerify()}>
                    <Search className="mr-2 h-4 w-4" />
                    {busyAction === "hedera" ? "Running..." : deriveHederaActionLabel(hederaForm.mode)}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Card className="border-border/60 bg-card/35 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-base">Hedera verify guidance</CardTitle>
                    <CardDescription>
                      Use this when inspecting protected HCS activity through the authenticated Hedera trust surface.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div>
                      <div className="font-semibold text-foreground/90">Verify only</div>
                      <div>Confirms integrity signals without requesting decrypted payload output.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Decrypt only</div>
                      <div>Requests decrypted payload when the actor is authorized to access it.</div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground/90">Decrypt and verify</div>
                      <div>Combines integrity inspection with protected payload access for one targeted record.</div>
                    </div>
                  </CardContent>
                </Card>

                {hederaResult ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <SummaryCard
                      icon={CheckCircle2}
                      title="Verification"
                      value={
                        hederaVerifyState == null
                          ? "Unknown"
                          : hederaVerifyState
                            ? "Verified"
                            : "Failed"
                      }
                      hint="Best available verify signal derived from the returned envelope."
                    />
                    <SummaryCard
                      icon={LockKeyhole}
                      title="Payload access"
                      value={hederaDecryptedPayload != null ? "Returned" : "Not returned"}
                      hint="Decrypted payload appears only when requested and authorized."
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {hederaResult ? (
              <>
                {hederaDecryptedPayload != null ? (
                  <Card className="border-border/60 bg-card/25">
                    <CardHeader>
                      <CardTitle className="text-base">Decrypted payload</CardTitle>
                      <CardDescription>
                        Returned by the Hedera protected-read workflow when permitted for the current actor.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <JsonBlock value={hederaDecryptedPayload} emptyLabel="No decrypted payload returned" />
                    </CardContent>
                  </Card>
                ) : null}

                <Card className="border-border/60 bg-card/25">
                  <CardHeader>
                    <CardTitle className="text-base">Raw Hedera result</CardTitle>
                    <CardDescription>
                      Full response returned by the Hedera verify/decrypt route.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonBlock value={hederaEnvelope} emptyLabel="No result returned" />
                  </CardContent>
                </Card>

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link to="/app/hedera/hcs">
                      <Radio className="mr-2 h-4 w-4" />
                      Open Hedera HCS workspace
                    </Link>
                  </Button>

                  <Button asChild variant="outline">
                    <Link to="/app/hedera/decrypt">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open full decrypt workspace
                    </Link>
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </EntitySection>
    </div>
  );
}