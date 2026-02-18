// src/plugins/requestId.ts
import type { FastifyInstance } from "fastify";

function clampStr(v: unknown, max = 128): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function isSafeClientRequestId(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > 128) return false;
  // allow a conservative charset to avoid log injection / weirdness
  // (letters, numbers, underscore, dash, dot, colon)
  return /^[A-Za-z0-9_.:-]+$/.test(s);
}

export async function requestIdPlugin(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const serverRid = String((req as any).id ?? "");
    if (serverRid) reply.header("x-request-id", serverRid);

    const hdr = req.headers["x-request-id"];
    const clientRid =
      isSafeClientRequestId(hdr)
        ? hdr.trim()
        : Array.isArray(hdr) && hdr.length > 0 && isSafeClientRequestId(hdr[0])
          ? String(hdr[0]).trim()
          : null;

    // Attach lightweight context for downstream logs/handlers (optional)
    (req as any).requestId = serverRid || null;
    if (clientRid) {
      (req as any).clientRequestId = clientRid;
      const clipped = clampStr(clientRid, 128);
      if (clipped) reply.header("x-client-request-id", clipped);

      // Bind into Fastify logger context if available
      const log = (req as any).log;
      if (log && typeof log.child === "function") {
        (req as any).log = log.child({ client_request_id: clientRid });
      }
    }
  });
}
