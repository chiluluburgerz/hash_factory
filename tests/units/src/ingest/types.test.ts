// ============================================================================
// File: tests/units/ingest/types.test.ts
// Version: 1.0.0-hf-ingest-types-type-unit | 2026-03-07
// Purpose:
//   Type-level tests for src/ingest/types.ts
// Notes:
//   - Runtime assertions are not useful here because these are erased TS types.
//   - Uses Vitest expectTypeOf for compile-time coverage.
// ============================================================================

import { describe, it, expectTypeOf } from "vitest";
import type {
  FileMaterial,
  FileSetMaterial,
  IngestBundleV1,
  IngestIdentity,
  IngestInput,
  IngestItem,
  IngestMaterial,
  IngestMode,
  IngestPlan,
  IngestResult,
  IngestRules,
  JsonMaterial,
  MerkleInfo,
  ScannedFile,
  TextMaterial,
} from "../../../../src/ingest/types.js";

describe("ingest/types (type-level)", () => {
  it("IngestMode exposes the expected literal union", () => {
    expectTypeOf<IngestMode>().toEqualTypeOf<
      "hash_only" | "merkle_only" | "register_and_anchor"
    >();
  });

  it("material variants have the expected shapes", () => {
    expectTypeOf<JsonMaterial>().toMatchTypeOf<{
      kind: "json";
      value: unknown;
    }>();

    expectTypeOf<TextMaterial>().toMatchTypeOf<{
      kind: "text";
      text: string;
      media_type?: string | null;
    }>();

    expectTypeOf<FileMaterial>().toMatchTypeOf<{
      kind: "file";
      path: string;
    }>();

    expectTypeOf<FileSetMaterial>().toMatchTypeOf<{
      kind: "file_set";
      root_dir: string;
      rules?: IngestRules;
    }>();
  });

  it("IngestMaterial is the union of all material variants", () => {
    expectTypeOf<IngestMaterial>().toEqualTypeOf<
      JsonMaterial | TextMaterial | FileMaterial | FileSetMaterial
    >();
  });

  it("IngestIdentity and IngestRules expose optional fields as expected", () => {
    expectTypeOf<IngestIdentity>().toMatchTypeOf<{
      object_key: string;
      object_kind: "json" | "text" | "file" | "file_set";
      version_label?: string | null;
      program?: string | null;
    }>();

    expectTypeOf<IngestRules>().toMatchTypeOf<{
      include_globs?: readonly string[];
      exclude_globs?: readonly string[];
      allowed_suffixes?: readonly string[];
      max_files?: number;
      max_total_bytes?: number;
      max_single_file_bytes?: number;
      follow_symlinks?: boolean;
      redact_paths?: boolean;
      normalize_line_endings?: boolean;
    }>();
  });

  it("IngestInput and IngestPlan expose the expected top-level structure", () => {
    expectTypeOf<IngestInput>().toMatchTypeOf<{
      mode: IngestMode;
      identity: IngestIdentity;
      material: IngestMaterial;
      metadata?: Readonly<Record<string, unknown>>;
      evidence_pointer?: string | null;
      domain?: string | null;
      proof_date?: string | null;
    }>();

    expectTypeOf<IngestPlan>().toMatchTypeOf<{
      object_key: string;
      plan_id: string;
      steps: readonly (
        | "normalize"
        | "scan"
        | "hash"
        | "merkle"
        | "bundle"
        | "anchor_payload"
      )[];
    }>();
  });

  it("ScannedFile, IngestItem, and MerkleInfo shapes are stable", () => {
    expectTypeOf<ScannedFile>().toMatchTypeOf<{
      path_rel: string;
      abs_path: string;
      bytes: number;
    }>();

    expectTypeOf<IngestItem>().toMatchTypeOf<{
      item_kind: "json" | "text" | "file";
      path_rel?: string;
      path_hash?: string;
      media_type?: string | null;
      bytes: number;
      sha3_512: string;
      leaf_hash: string;
    }>();

    expectTypeOf<MerkleInfo>().toMatchTypeOf<{
      leaf_count: number;
      root: string;
    }>();
  });

  it("IngestBundleV1 and IngestResult expose the expected deterministic contract", () => {
    expectTypeOf<IngestBundleV1>().toMatchTypeOf<{
      bundle_version: "v1";
      hash_contract: {
        contract_id: "hf-contract-v1";
        frame: "hf:frame:v1";
        canonical_json: "hf:canonical-json:v1";
        algorithm: "sha3-512";
        encoding: "hex_lower";
      };
      identity: IngestIdentity;
      rules: {
        path_normalization: "posix_rel_no_dotdot";
        follow_symlinks: boolean;
        redact_paths: boolean;
        normalize_line_endings: boolean;
        ordering: "deterministic_sort_v1";
        merkle_rule: "dup_last_on_odd";
        include_globs?: readonly string[];
        exclude_globs?: readonly string[];
        allowed_suffixes?: readonly string[];
      };
      items: readonly IngestItem[];
      merkle?: MerkleInfo;
      summary: {
        item_count: number;
        total_bytes: number;
      };
    }>();

    expectTypeOf<IngestResult>().toMatchTypeOf<{
      object_key: string;
      object_kind: "json" | "text" | "file" | "file_set";
      fingerprint: string;
      bundle_digest: string;
      merkle_root?: string;
      bundle: IngestBundleV1;
      idempotency_key: string;
    }>();
  });
});