// src/auth/actor.ts
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_ROLES = new Set(["viewer", "editor", "tenant_admin"] as const);
const VALID_AUTH_TYPES = new Set([
  "api_key",
  "dev_header",
  "jwt",
  "session",
  "public",
  "bootstrap",
  "system",
] as const);

export type OrgRole = "viewer" | "editor" | "tenant_admin";
export type AuthType =
  | "api_key"
  | "dev_header"
  | "jwt"
  | "session"
  | "public"
  | "bootstrap"
  | "system";

export type Actor = Readonly<{
  user_id: string;
  org_id: string;
  org_role: OrgRole;
  is_system_admin: boolean;
  api_key_id: string | null;
  scopes: ReadonlyArray<string>;
  auth_type: AuthType;
}>;

function asUuidOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!UUID_RE.test(s)) return null;
  return s.toLowerCase();
}

function normalizeScopes(scopes: unknown): string[] {
  const MAX_SCOPES = 32;
  const MAX_SCOPE_LEN = 64;

  if (scopes == null) return [];

  if (Array.isArray(scopes)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of scopes) {
      const x = String(v).trim();
      if (!x) continue;
      if (x.length > MAX_SCOPE_LEN) continue;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      if (out.length >= MAX_SCOPES) break;
    }
    return out;
  }

  if (typeof scopes === "string") {
    const s = scopes.trim();
    if (!s) return [];

    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) return normalizeScopes(parsed);
    } catch {
      // ignore; treat as CSV
    }

    const out: string[] = [];
    const seen = new Set<string>();
    for (const part of s.split(",")) {
      const x = String(part).trim();
      if (!x) continue;
      if (x.length > MAX_SCOPE_LEN) continue;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      if (out.length >= MAX_SCOPES) break;
    }
    return out;
  }

  return [];
}

export class ActorError extends Error {
  code: string;
  statusCode: number;
  cause?: unknown;

  constructor(message: string, opts?: { code?: string; statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = "ActorError";
    this.code = opts?.code ?? "ACTOR_INVALID";
    this.statusCode = opts?.statusCode ?? 500;
    this.cause = opts?.cause;
  }
}

export function assertActor(actor: unknown): asserts actor is Actor {
  if (!actor || typeof actor !== "object") {
    throw new ActorError("Actor missing", { statusCode: 401, code: "AUTH_REQUIRED" });
  }

  const a = actor as any;

  if (!VALID_AUTH_TYPES.has(a.auth_type)) {
    throw new ActorError("Invalid auth_type", { statusCode: 401, code: "AUTH_INVALID" });
  }

  if (!a.user_id || !a.org_id) {
    throw new ActorError("Actor missing required identity fields", {
      statusCode: 401,
      code: "AUTH_INVALID",
    });
  }

  const uid = asUuidOrNull(a.user_id);
  const oid = asUuidOrNull(a.org_id);
  if (!uid || !oid) {
    throw new ActorError("Actor missing required identity fields", {
      statusCode: 401,
      code: "AUTH_INVALID",
    });
  }

  if (a.auth_type === "api_key") {
    const kid = asUuidOrNull(a.api_key_id);
    if (!kid) {
      throw new ActorError("Actor missing api_key_id", { statusCode: 401, code: "AUTH_INVALID" });
    }
    try {
      a.api_key_id = kid;
    } catch {
      // ignore if frozen
    }
  } else if (a.api_key_id != null) {
    // If present for non-api_key auth, ensure it's not garbage
    const kid = asUuidOrNull(a.api_key_id);
    if (!kid) throw new ActorError("Invalid api_key_id", { statusCode: 401, code: "AUTH_INVALID" });
    try { a.api_key_id = kid; } catch {}
  }

  if (a.auth_type === "api_key" && !a.api_key_id) {
   throw new ActorError("Actor missing api_key_id", { statusCode: 401, code: "AUTH_INVALID" });
  }

  const role = String(a.org_role || "").trim();
  if (!VALID_ROLES.has(role as any)) {
    throw new ActorError("Actor has invalid org_role", { statusCode: 401, code: "AUTH_INVALID" });
  }

  const normalizedScopes = normalizeScopes(a.scopes);

  try {
    a.user_id = uid;
    a.org_id = oid;
    a.scopes = Object.freeze(normalizedScopes);
  } catch {
  }
}

export function makeActorFromApiKeyRow(row: any): Actor {
  const api_key_id = asUuidOrNull(row?.api_key_id);
  const org_id = asUuidOrNull(row?.org_id);
  const user_id = asUuidOrNull(row?.user_id);

  if (!api_key_id || !org_id || !user_id) {
    throw new ActorError("api_key_lookup returned invalid identity fields", {
      statusCode: 401,
      code: "AUTH_INVALID",
    });
  }

  const dbRole = String(row?.org_role || "").trim();
  const org_role: OrgRole = VALID_ROLES.has(dbRole as any) ? (dbRole as OrgRole) : "viewer";

  const actor: Actor = Object.freeze({
    user_id,
    org_id,
    org_role,
    is_system_admin: Boolean(row?.is_system_admin),
    api_key_id,
    scopes: Object.freeze(normalizeScopes(row?.scopes)),
    auth_type: "api_key",
  });

  assertActor(actor);
  return actor;
}

export function hasScope(actor: Actor, requiredScope?: string): boolean {
  assertActor(actor);
  if (!requiredScope) return true;
  return actor.scopes.includes(requiredScope);
}

export function hasAnyScope(actor: Actor, scopes: string[] = []): boolean {
  assertActor(actor);
  if (!Array.isArray(scopes) || scopes.length === 0) return true;
  const set = new Set(actor.scopes);
  return scopes.some((s) => set.has(s));
}