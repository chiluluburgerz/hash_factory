// /src/plugins/securityHeaders.ts
import type { FastifyInstance } from "fastify";
import { applyNoSniff, applyNoStore } from "../utils/securityHeaders.js";

export async function securityHeadersPlugin(app: FastifyInstance) {
  app.addHook("onSend", async (_req, reply, payload) => {
    applyNoSniff(reply);
    applyNoStore(reply);
    return payload;
  });
}