import type { FastifyInstance } from "fastify";
import { CoreClient } from "../core/coreClient.js";

export async function smokeCoreRoutes(app: FastifyInstance) {
  const baseUrl = String(process.env.CORE_BACKEND_URL || "").trim();
  const apiKey = String(process.env.CORE_SERVICE_API_KEY || "").trim();

  if (!baseUrl) throw new Error("CORE_BACKEND_URL is required");
  if (!apiKey) throw new Error("CORE_SERVICE_API_KEY is required");

  const core = new CoreClient({
    baseUrl,
    apiKey,
    timeoutMs: 8000,
    maxRetries: 0,
  });

  app.get("/v1/smoke/core/livez", async (req, reply) => {
    const res = await core.get("/livez", {
      requestId: (req as any).id ?? null,
      clientRequestId: (req as any).clientRequestId ?? null,
      hfActor: (req as any).actor?.user_id ?? null,
      onCoreCall: (line) => req.log.info(line, "core_call"),
    });

    reply.send({ ok: true, core: res });
  });
}