import { describe, it, expect } from "vitest";
import { frame } from "../../../../src/hashing/domain.js";
import { DOMAIN_MIN, DOMAIN_MAX, MAX_PAYLOAD_BYTES } from "../../../../src/hashing/limits.js";

function expectDomainErr(fn: () => any, msgIncludes: string) {
  try {
    fn();
    throw new Error("Expected error");
  } catch (e: any) {
    expect(String(e?.message || "")).toContain(msgIncludes);
  }
}

function readU16BE(buf: Uint8Array, off: number): number {
  const b = Buffer.from(buf);
  return b.readUInt16BE(off);
}
function readU32BE(buf: Uint8Array, off: number): number {
  const b = Buffer.from(buf);
  return b.readUInt32BE(off);
}

describe("hashing/domain.ts (unit)", () => {
  it("rejects invalid domain length", () => {
    expectDomainErr(() => frame("", new Uint8Array([1])), "domain_invalid: length");
    const tooLong = "a".repeat(DOMAIN_MAX + 1);
    expectDomainErr(() => frame(tooLong, new Uint8Array([1])), "domain_invalid: length");
    if (DOMAIN_MIN > 1) {
      const tooShort = "a".repeat(DOMAIN_MIN - 1);
      expectDomainErr(() => frame(tooShort, new Uint8Array([1])), "domain_invalid: length");
    }
  });

  it("rejects domain not matching allowed regex", () => {
    expectDomainErr(() => frame("A", new Uint8Array([1])), "domain_invalid: must match");
    expectDomainErr(() => frame("a*", new Uint8Array([1])), "domain_invalid: must match");
    expectDomainErr(() => frame("-a", new Uint8Array([1])), "domain_invalid: must match");
    expectDomainErr(() => frame("a*", new Uint8Array([1])), "domain_invalid: must match");
  });

  it("rejects non-ascii domain (fails regex before ascii check)", () => {
    expectDomainErr(
      () => frame("aé", new Uint8Array([1])),
      "domain_invalid: must match"
    );
  });

  it("rejects invalid payload type and oversized payload", () => {
    expectDomainErr(() => frame("a", null as any), "payload_invalid: must be Uint8Array");

    // Avoid massive allocations
    const n = Math.min(MAX_PAYLOAD_BYTES + 1, MAX_PAYLOAD_BYTES + 1);
    const big = new Uint8Array(n);
    expectDomainErr(() => frame("a", big), "payload_invalid: too large");
  });

  it("frames bytes deterministically with magic, lengths, and payload", () => {
    const domain = "hf:test";
    const payload = new Uint8Array([10, 11, 12]);
    const out = frame(domain, payload);

    const magic = Buffer.from("hf:frame:v1", "utf8");
    const outB = Buffer.from(out);

    // MAGIC
    expect(outB.subarray(0, magic.length).toString("utf8")).toBe("hf:frame:v1");

    // 0x00 separator
    expect(outB[magic.length]).toBe(0x00);

    // u16be(domainLen)
    const domainLenOff = magic.length + 1;
    const domainLen = readU16BE(out, domainLenOff);
    expect(domainLen).toBe(domain.length);

    // domain bytes
    const domainOff = domainLenOff + 2;
    expect(outB.subarray(domainOff, domainOff + domainLen).toString("utf8")).toBe(domain);

    // u32be(payloadLen)
    const payloadLenOff = domainOff + domainLen;
    const payloadLen = readU32BE(out, payloadLenOff);
    expect(payloadLen).toBe(payload.byteLength);

    // payload bytes
    const payloadOff = payloadLenOff + 4;
    expect(Array.from(outB.subarray(payloadOff, payloadOff + payloadLen))).toEqual(Array.from(payload));
  });

  it("trims domain before validation (no sneaky whitespace)", () => {
    // assertDomain uses trim; so " hf:test " becomes "hf:test".
    const out = frame(" hf:test ", new Uint8Array([1]));
    const outB = Buffer.from(out);
    expect(outB.includes(Buffer.from("hf:test", "utf8"))).toBe(true);
  });
});