import { describe, it, expect } from "vitest";

import { applyNoSniff, applyNoStore } from "../../../../src/utils/securityHeaders.js";

type FakeReply = {
  headers: Record<string, string>;
  header: (k: string, v: any) => FakeReply;
};

function makeReply(): FakeReply {
  const r: FakeReply = {
    headers: {},
    header(k: string, v: any) {
      r.headers[String(k)] = String(v);
      return r;
    },
  };
  return r;
}

describe("utils/securityHeaders.ts (unit)", () => {
  it("applyNoSniff sets X-Content-Type-Options: nosniff", () => {
    const reply = makeReply();
    applyNoSniff(reply as any);
    expect(reply.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("applyNoStore sets Cache-Control: no-store", () => {
    const reply = makeReply();
    applyNoStore(reply as any);
    expect(reply.headers["Cache-Control"]).toBe("no-store");
  });

  it("functions are idempotent (reapplying yields same value)", () => {
    const reply = makeReply();
    applyNoSniff(reply as any);
    applyNoSniff(reply as any);
    applyNoStore(reply as any);
    applyNoStore(reply as any);

    expect(reply.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(reply.headers["Cache-Control"]).toBe("no-store");
  });
});