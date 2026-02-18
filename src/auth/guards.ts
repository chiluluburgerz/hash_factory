// src/auth/guards.ts
import { ActorError, assertActor, type Actor } from "./actor.js";

export function requireAuthActor(actor: unknown): Actor {
  assertActor(actor);
  const a = actor as Actor;
  if (!a.user_id || !a.org_id) {
    throw new ActorError("Authentication required", { statusCode: 401, code: "AUTH_REQUIRED" });
  }
  return a;
}

export function isSystemAdmin(actor: Actor): boolean {
  return Boolean(actor.is_system_admin);
}

export function isTenantAdmin(actor: Actor): boolean {
  return actor.org_role === "tenant_admin";
}

export function requireTenantAdminOrSystem(actor: unknown): true {
  const a = requireAuthActor(actor);
  if (isSystemAdmin(a) || isTenantAdmin(a)) return true;
  throw new ActorError("tenant_admin_required", { statusCode: 403, code: "AUTH_DENIED" });
}