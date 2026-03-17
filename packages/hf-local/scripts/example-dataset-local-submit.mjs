import {
  executeDatasetAnchorLocalThenSubmit,
} from "../dist/index.js";

const HF_BASE_URL = process.env.HF_BASE_URL || "http://localhost:3000";
const HF_API_KEY = process.env.HF_API_KEY || "";

const TEST_ROOT_DIR = process.env.TEST_ROOT_DIR || "";
const TEST_DATASET_KEY = process.env.TEST_DATASET_KEY || "hf_local_test_dataset_001";
const TEST_PROGRAM = process.env.TEST_PROGRAM || "program";
const TEST_VERSION_LABEL = process.env.TEST_VERSION_LABEL || "v1";
const TEST_DISPLAY_NAME =
  process.env.TEST_DISPLAY_NAME || "HF local submit dataset test";
const TEST_EVIDENCE_POINTER = process.env.TEST_EVIDENCE_POINTER || "";

if (!HF_API_KEY) {
  throw new Error("Missing HF_API_KEY");
}

if (!TEST_ROOT_DIR) {
  throw new Error("Missing TEST_ROOT_DIR");
}

if (!TEST_EVIDENCE_POINTER) {
  throw new Error("Missing TEST_EVIDENCE_POINTER");
}

async function main() {
  console.log("\n[1] Running local -> HF dataset submit flow...\n");

  const result = await executeDatasetAnchorLocalThenSubmit(
    {
      baseUrl: HF_BASE_URL,
      auth: {
        apiKey: HF_API_KEY,
      },
    },
    {
      identity: {
        dataset_key: TEST_DATASET_KEY,
        program: TEST_PROGRAM,
        version_label: TEST_VERSION_LABEL,
      },
      root_dir: TEST_ROOT_DIR,
      display_name: TEST_DISPLAY_NAME,
      metadata: {
        source: "hf-local-package",
        dataset_key: TEST_DATASET_KEY,
        program: TEST_PROGRAM,
        version_label: TEST_VERSION_LABEL,
        test_source: "dataset-local-submit-example",
      },
      evidence_pointer: TEST_EVIDENCE_POINTER,
      publish_visibility: "unlisted",
      set_active: true,
      hooks: {
        onScanProgress: (p) => {
          if (p?.event === "dir") {
            console.log("[scan:dir]", p.rel ?? ".", p.files_seen ?? 0, p.total_bytes_seen ?? 0);
          }
        },
        onHashProgress: (p) => {
          if (p?.event === "file_done") {
            console.log("[hash:file_done]", p.path_rel, p.bytes, p.sha3_512_prefix);
          }
        },
      },
    }
  );

  const localEvidence = result.local.evidence;
  const localReceipt = result.local.receipt;
  const remote = result.remote;

  console.log("[result summary]");
  console.log(
    JSON.stringify(
      {
        local_dataset_fingerprint: localEvidence.dataset_fingerprint,
        remote_dataset_fingerprint: remote.evidence?.dataset_fingerprint ?? null,
        local_bundle_digest: localEvidence.bundle_digest,
        remote_bundle_digest: remote.evidence?.bundle_digest ?? null,
        local_merkle_root: localEvidence.merkle_root,
        remote_merkle_root: remote.evidence?.merkle_root ?? null,
        local_receipt_id: localReceipt.receipt_id,
        remote_receipt_id: remote.receipt?.receipt_id ?? null,
        core_dataset_key: remote.core?.dataset?.dataset_key ?? null,
        core_version: remote.core?.version?.version ?? null,
        core_manifest_hash: remote.core?.version?.manifest_hash ?? null,
        replay_reused: remote.core?.replay?.reused ?? null,
        replay_detected: remote.core?.replay?.replay ?? null,
        replay_reason: remote.core?.replay?.replay_reason ?? null,
      },
      null,
      2
    )
  );

  console.log("\n[2] Full local receipt\n");
  console.log(JSON.stringify(localReceipt, null, 2));

  console.log("\n[3] Full remote payload\n");
  console.log(JSON.stringify(remote, null, 2));
}

main().catch((err) => {
  console.error("\n[local-submit failed]");
  console.error(err);
  process.exit(1);
});