// ============================================================================
// File: tests/units/src/datasets/types.test.ts
// Version: 1.0.0-hf-datasets-types-type-unit | 2026-03-07
// Purpose:
//   Type-level tests for src/datasets/types.ts
// Notes:
//   - Runtime assertions are not useful here because these are erased TS types.
//   - Uses Vitest expectTypeOf for compile-time coverage.
// ============================================================================

import { describe, it, expectTypeOf } from "vitest";
import type {
  AnchorInput,
  AnchorPlan,
  AnchorResult,
  DatasetAnchorMode,
  DatasetBundleV1,
  DatasetIdentity,
  DatasetRules,
  HashedFile,
  MerkleInfo,
  ScannedFile,
} from "../../../../src/datasets/types.js";

describe("datasets/types (type-level)", () => {
  it("DatasetAnchorMode exposes the expected literal union", () => {
    expectTypeOf<DatasetAnchorMode>().toEqualTypeOf<
      "hash_only" | "register_and_anchor"
    >();
  });

  it("DatasetIdentity and DatasetRules expose optional fields as expected", () => {
    expectTypeOf<DatasetIdentity>().toMatchTypeOf<{
      dataset_key: string;
      version_label?: string | null;
      program?: string | null;
    }>();

    expectTypeOf<DatasetRules>().toMatchTypeOf<{
      include_globs?: readonly string[];
      exclude_globs?: readonly string[];
      allowed_suffixes?: readonly string[];
      max_files?: number;
      max_total_bytes?: number;
      max_single_file_bytes?: number;
      follow_symlinks?: boolean;
      redact_paths?: boolean;
    }>();
  });

  it("AnchorInput and AnchorPlan expose the expected top-level structure", () => {
    expectTypeOf<AnchorInput>().toMatchTypeOf<{
      identity: DatasetIdentity;
      root_dir: string;
      rules?: DatasetRules;
      mode?: DatasetAnchorMode;
    }>();

    expectTypeOf<AnchorPlan>().toMatchTypeOf<{
      dataset_key: string;
      plan_id: string;
      steps: readonly (
        | "scan"
        | "hash"
        | "bundle"
        | "core_upsert"
        | "core_version"
        | "core_publish"
      )[];
    }>();
  });

  it("ScannedFile, HashedFile, and MerkleInfo shapes are stable", () => {
    expectTypeOf<ScannedFile>().toMatchTypeOf<{
      path_rel: string;
      abs_path: string;
      bytes: number;
    }>();

    expectTypeOf<HashedFile>().toMatchTypeOf<{
      path_rel?: string;
      path_hash?: string;
      bytes: number;
      sha3_512: string;
      leaf_hash: string;
    }>();

    expectTypeOf<MerkleInfo>().toMatchTypeOf<{
      leaf_count: number;
      root: string;
    }>();
  });

  it("DatasetBundleV1 and AnchorResult expose the expected deterministic contract", () => {
    expectTypeOf<DatasetBundleV1>().toMatchTypeOf<{
      bundle_version: "v1";
      hash_contract: {
        contract_id: "hf-contract-v1";
        frame: "hf:frame:v1";
        canonical_json: "hf:canonical-json:v1";
        algorithm: "sha3-512";
        encoding: "hex_lower";
      };
      dataset_identity: DatasetIdentity;
      rules: {
        path_normalization: "posix_rel_no_dotdot";
        follow_symlinks: boolean;
        redact_paths: boolean;
        ordering: "path_rel_ascii_asc";
        merkle_rule: "dup_last_on_odd";
        include_globs?: readonly string[];
        exclude_globs?: readonly string[];
        allowed_suffixes?: readonly string[];
      };
      files: readonly HashedFile[];
      merkle: MerkleInfo;
      summary: {
        file_count: number;
        total_bytes: number;
      };
    }>();

    expectTypeOf<AnchorResult>().toMatchTypeOf<{
      dataset_key: string;
      dataset_fingerprint: string;
      bundle_digest: string;
      merkle_root: string;
      bundle: DatasetBundleV1;
      idempotency_key: string;
    }>();
  });
});