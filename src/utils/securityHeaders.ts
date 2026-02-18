// /src/utils/securityHeaders.ts
import type { FastifyReply } from "fastify";

export function applyNoSniff(reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
}

export function applyNoStore(reply: FastifyReply): void {
  // Hash/verify responses can include user-provided material (or act as an oracle).
  // Default to no-store; selectively override for GET endpoints later if needed.
  reply.header("Cache-Control", "no-store");
}