import { describe, it, expect } from "vitest";
import {
  ActorError,
  assertActor,
  makeActorFromApiKeyRow,
  hasScope,
  hasAnyScope,
  type Actor,
} from "../../../../src/auth/actor.js";

const U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const O1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const K1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function baseActor(overrides: Partial<any> = {}): any {
  return {
    user_id: U1,
    org_id: O1,
    org_role: "viewer",
    is_system_admin: false,
    api_key_id: null,
    scopes: [],
    auth_type: "public",
    ...overrides,
  };
}

function expectActorError(
  fn: () => any,
  opts: { statusCode?: number; code?: string; messageIncludes?: string } = {}
) {
  try {
    fn();
    throw new Error("Expected ActorError");
  } catch (e: any) {
    expect(e).toBeInstanceOf(ActorError);
    if (opts.statusCode != null) expect(e.statusCode).toBe(opts.statusCode);
    if (opts.code != null) expect(e.code).toBe(opts.code);
    if (opts.messageIncludes) expect(String(e.message)).toContain(opts.messageIncludes);
  }
}

describe("auth/actor.ts (unit)", () => {
  describe("assertActor()", () => {
    it("throws AUTH_REQUIRED when actor is missing", () => {
      expectActorError(() => assertActor(null), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => assertActor(undefined), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => assertActor("nope"), { statusCode: 401, code: "AUTH_REQUIRED" });
    });

    it("throws AUTH_INVALID when auth_type is invalid", () => {
      const a = baseActor({ auth_type: "nope" });
      expectActorError(() => assertActor(a), { statusCode: 401, code: "AUTH_INVALID" });
    });

    it("throws AUTH_INVALID when identity fields missing", () => {
      expectActorError(() => assertActor(baseActor({ user_id: "" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
      expectActorError(() => assertActor(baseActor({ org_id: "" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
    });

    it("throws AUTH_INVALID when identity UUIDs are invalid", () => {
      expectActorError(() => assertActor(baseActor({ user_id: "not-a-uuid" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
      expectActorError(() => assertActor(baseActor({ org_id: "not-a-uuid" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
    });

    it("normalizes user_id and org_id to lowercase when valid UUIDs", () => {
      const a = baseActor({
        user_id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        org_id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
      });
      assertActor(a);
      expect(a.user_id).toBe(U1);
      expect(a.org_id).toBe(O1);
    });

    it("throws AUTH_INVALID when org_role is invalid", () => {
      expectActorError(() => assertActor(baseActor({ org_role: "owner" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
    });

    it("requires api_key_id when auth_type=api_key", () => {
      expectActorError(() => assertActor(baseActor({ auth_type: "api_key", api_key_id: null })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
      expectActorError(() => assertActor(baseActor({ auth_type: "api_key", api_key_id: "" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
      expectActorError(
        () => assertActor(baseActor({ auth_type: "api_key", api_key_id: "not-a-uuid" })),
        { statusCode: 401, code: "AUTH_INVALID" }
      );
    });

    it("normalizes api_key_id to lowercase for auth_type=api_key", () => {
      const a = baseActor({
        auth_type: "api_key",
        api_key_id: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      });
      assertActor(a);
      expect(a.api_key_id).toBe(K1);
    });

    it("if api_key_id present for non-api_key, it must be a valid UUID", () => {
      expectActorError(
        () => assertActor(baseActor({ auth_type: "jwt", api_key_id: "garbage" })),
        { statusCode: 401, code: "AUTH_INVALID" }
      );

      const a = baseActor({
        auth_type: "jwt",
        api_key_id: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      });
      assertActor(a);
      expect(a.api_key_id).toBe(K1);
    });

    it("normalizes scopes: array, trims, dedupes, limits length + count, freezes", () => {
      const long = "x".repeat(100);
      const a = baseActor({
        scopes: [" a ", "b", "a", "", "   ", long, "c"],
      });

      assertActor(a);

      // long dropped, trimmed, deduped
      expect(a.scopes).toEqual(["a", "b", "c"]);
      expect(Object.isFrozen(a.scopes)).toBe(true);
    });

    it("normalizes scopes from JSON string (array)", () => {
      const a = baseActor({ scopes: '["a","b","a","  c  "]' });
      assertActor(a);
      expect(a.scopes).toEqual(["a", "b", "c"]);
    });

    it("normalizes scopes from CSV string fallback when JSON parse fails", () => {
      const a = baseActor({ scopes: " a, b ,a, , c " });
      assertActor(a);
      expect(a.scopes).toEqual(["a", "b", "c"]);
    });

    it("caps scope count at 32", () => {
      const scopes = Array.from({ length: 100 }, (_, i) => `s${i}`);
      const a = baseActor({ scopes });
      assertActor(a);
      expect(a.scopes.length).toBe(32);
      expect(a.scopes[0]).toBe("s0");
      expect(a.scopes[31]).toBe("s31");
    });

    it("caps each scope length at 64", () => {
      const ok = "x".repeat(64);
      const tooLong = "y".repeat(65);

      const a = baseActor({ scopes: [ok, tooLong, "z"] });
      assertActor(a);
      expect(a.scopes).toEqual([ok, "z"]);
    });

    it("works with frozen actor objects (no throw on attempted normalization)", () => {
      const a = Object.freeze(
        baseActor({
          user_id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
          org_id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
          auth_type: "api_key",
          api_key_id: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
          scopes: [" a ", "a", "b"],
        })
      );

      assertActor(a);

      expect(hasScope(a as Actor, "a")).toBe(true);
      expect(hasAnyScope(a as Actor, ["nope", "b"])).toBe(true);
    });
  });

  describe("makeActorFromApiKeyRow()", () => {
    it("builds a valid api_key actor from a well-formed lookup row", () => {
      const actor = makeActorFromApiKeyRow({
        api_key_id: K1,
        org_id: O1,
        user_id: U1,
        org_role: "editor",
        is_system_admin: true,
        scopes: ["viewer:read", "datasets:write", "viewer:read"],
      });

      expect(actor.auth_type).toBe("api_key");
      expect(actor.api_key_id).toBe(K1);
      expect(actor.user_id).toBe(U1);
      expect(actor.org_id).toBe(O1);
      expect(actor.org_role).toBe("editor");
      expect(actor.is_system_admin).toBe(true);
      expect(actor.scopes).toEqual(["viewer:read", "datasets:write"]);
      expect(Object.isFrozen(actor)).toBe(true);
      expect(Object.isFrozen(actor.scopes)).toBe(true);
    });

    it("defaults invalid org_role from DB to viewer", () => {
      const actor = makeActorFromApiKeyRow({
        api_key_id: K1,
        org_id: O1,
        user_id: U1,
        org_role: "owner",
        scopes: [],
      });

      expect(actor.org_role).toBe("viewer");
    });

    it("throws AUTH_INVALID if lookup row has invalid identity fields", () => {
      expectActorError(
        () =>
          makeActorFromApiKeyRow({
            api_key_id: "not-a-uuid",
            org_id: O1,
            user_id: U1,
          }),
        { statusCode: 401, code: "AUTH_INVALID" }
      );

      expectActorError(
        () =>
          makeActorFromApiKeyRow({
            api_key_id: K1,
            org_id: "not-a-uuid",
            user_id: U1,
          }),
        { statusCode: 401, code: "AUTH_INVALID" }
      );

      expectActorError(
        () =>
          makeActorFromApiKeyRow({
            api_key_id: K1,
            org_id: O1,
            user_id: "not-a-uuid",
          }),
        { statusCode: 401, code: "AUTH_INVALID" }
      );
    });
  });

  describe("hasScope() / hasAnyScope()", () => {
    it("hasScope: returns true when requiredScope is omitted", () => {
      const a = baseActor({ scopes: [] });
      assertActor(a);
      expect(hasScope(a as Actor)).toBe(true);
    });

    it("hasScope: checks membership", () => {
      const a = baseActor({ scopes: ["a", "b"] });
      assertActor(a);
      expect(hasScope(a as Actor, "a")).toBe(true);
      expect(hasScope(a as Actor, "c")).toBe(false);
    });

    it("hasAnyScope: returns true when input list is empty", () => {
      const a = baseActor({ scopes: [] });
      assertActor(a);
      expect(hasAnyScope(a as Actor, [])).toBe(true);
      expect(hasAnyScope(a as Actor)).toBe(true);
    });

    it("hasAnyScope: returns true when any required scope is present", () => {
      const a = baseActor({ scopes: ["a", "b"] });
      assertActor(a);
      expect(hasAnyScope(a as Actor, ["x", "b", "y"])).toBe(true);
      expect(hasAnyScope(a as Actor, ["x", "y"])).toBe(false);
    });

    it("throws if actor invalid (defense in depth)", () => {
      expectActorError(() => hasScope(null as any, "a"), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => hasAnyScope(undefined as any, ["a"]), {
        statusCode: 401,
        code: "AUTH_REQUIRED",
      });

      expectActorError(() => hasScope({} as any, "a"), { statusCode: 401, code: "AUTH_INVALID" });
      expectActorError(() => hasAnyScope({} as any, ["a"]), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
    });
  });
});