// tests/units/src/auth/guards.test.ts
import { describe, it, expect } from "vitest";

import { ActorError, type Actor } from "../../../../src/auth/actor.js";
import {
  requireAuthActor,
  isSystemAdmin,
  isTenantAdmin,
  requireTenantAdminOrSystem,
} from "../../../../src/auth/guards.js";

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

describe("auth/guards.ts (unit)", () => {
  describe("requireAuthActor()", () => {
    it("throws AUTH_REQUIRED when actor is missing / non-object", () => {
      expectActorError(() => requireAuthActor(null), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => requireAuthActor(undefined), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => requireAuthActor("nope"), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => requireAuthActor(123 as any), { statusCode: 401, code: "AUTH_REQUIRED" });
    });

    it("throws AUTH_INVALID when actor shape is present but invalid (assertActor)", () => {
      expectActorError(
        () => requireAuthActor(baseActor({ auth_type: "nope" })),
        { statusCode: 401, code: "AUTH_INVALID" }
      );
      expectActorError(
        () => requireAuthActor(baseActor({ user_id: "not-a-uuid" })),
        { statusCode: 401, code: "AUTH_INVALID" }
      );
      expectActorError(
        () => requireAuthActor(baseActor({ org_id: "not-a-uuid" })),
        { statusCode: 401, code: "AUTH_INVALID" }
      );
    });

    it("returns the actor (typed) when valid and auth'd", () => {
      const a = baseActor({ scopes: ["x"] });
      const out = requireAuthActor(a);
      expect(out).toBe(a);
      expect((out as Actor).user_id).toBe(U1);
      expect((out as Actor).org_id).toBe(O1);
    });

    it("normalizes ids via assertActor (lowercases) and still returns the same object", () => {
      const a = baseActor({
        user_id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        org_id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
      });
      const out = requireAuthActor(a);
      expect(out).toBe(a);
      expect(out.user_id).toBe(U1);
      expect(out.org_id).toBe(O1);
    });

    it("throws AUTH_REQUIRED if user_id/org_id are missing after assertActor (defense-in-depth)", () => {
      const a: any = baseActor();
      Object.defineProperty(a, "user_id", { value: "", writable: true, configurable: true });
      expectActorError(() => requireAuthActor(a), { statusCode: 401, code: "AUTH_INVALID" });
    });

    it("works with frozen actor objects (assertActor must not throw during normalization)", () => {
      const a = Object.freeze(
        baseActor({
          auth_type: "api_key",
          api_key_id: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
          user_id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
          org_id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
          scopes: [" a ", "a", "b"],
        })
      );

      const out = requireAuthActor(a);
      expect(out.user_id).toBe("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"); // frozen: cannot rewrite
      expect(out.org_id).toBe("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
    });
  });

  describe("isSystemAdmin()", () => {
    it("returns true only when is_system_admin is truthy", () => {
      expect(isSystemAdmin(baseActor({ is_system_admin: true }) as Actor)).toBe(true);
      expect(isSystemAdmin(baseActor({ is_system_admin: 1 }) as any)).toBe(true);
      expect(isSystemAdmin(baseActor({ is_system_admin: false }) as Actor)).toBe(false);
      expect(isSystemAdmin(baseActor({ is_system_admin: 0 }) as any)).toBe(false);
      expect(isSystemAdmin(baseActor({ is_system_admin: null }) as any)).toBe(false);
    });
  });

  describe("isTenantAdmin()", () => {
    it("returns true only when org_role is tenant_admin", () => {
      expect(isTenantAdmin(baseActor({ org_role: "tenant_admin" }) as Actor)).toBe(true);
      expect(isTenantAdmin(baseActor({ org_role: "viewer" }) as Actor)).toBe(false);
      expect(isTenantAdmin(baseActor({ org_role: "editor" }) as Actor)).toBe(false);
    });
  });

  describe("requireTenantAdminOrSystem()", () => {
    it("returns true for system admin", () => {
      const a = baseActor({ is_system_admin: true, org_role: "viewer" });
      expect(requireTenantAdminOrSystem(a)).toBe(true);
    });

    it("returns true for tenant_admin", () => {
      const a = baseActor({ is_system_admin: false, org_role: "tenant_admin" });
      expect(requireTenantAdminOrSystem(a)).toBe(true);
    });

    it("denies non-admin actors with AUTH_DENIED 403", () => {
      const a = baseActor({ is_system_admin: false, org_role: "viewer" });
      expectActorError(() => requireTenantAdminOrSystem(a), {
        statusCode: 403,
        code: "AUTH_DENIED",
        messageIncludes: "tenant_admin_required",
      });
    });

    it("propagates assertActor errors for invalid actors", () => {
      expectActorError(() => requireTenantAdminOrSystem(null), { statusCode: 401, code: "AUTH_REQUIRED" });
      expectActorError(() => requireTenantAdminOrSystem(baseActor({ auth_type: "nope" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
      });
    });

    it("accepts api_key actor when api_key_id is present and valid", () => {
      const a = baseActor({
        auth_type: "api_key",
        api_key_id: K1,
        org_role: "tenant_admin",
      });
      expect(requireTenantAdminOrSystem(a)).toBe(true);
    });
  });
});