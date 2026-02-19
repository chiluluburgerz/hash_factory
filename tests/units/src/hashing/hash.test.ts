import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { hashBytes, encodeDigest } from "../../../../src/hashing/hash.js";

function u8(...xs: number[]) {
  return new Uint8Array(xs);
}

describe("hashing/hash.ts (unit)", () => {
  describe("hashBytes()", () => {
    it("rejects invalid bytes type", () => {
      expect(() => hashBytes({ alg: "sha3-512", bytes: null as any })).toThrow(
        /hashBytes_invalid_bytes/
      );
    });

    it("computes sha3-512 digest bytes deterministically", () => {
      const bytes = Buffer.from("abc", "utf8");
      const out = hashBytes({ alg: "sha3-512", bytes });

      const expected = crypto.createHash("sha3-512").update(bytes).digest();
      expect(Buffer.from(out).equals(expected)).toBe(true);
      expect(out.byteLength).toBe(64);
    });

    it("is stable for identical inputs and differs for different inputs", () => {
      const a1 = hashBytes({ alg: "sha3-512", bytes: u8(1, 2, 3) });
      const a2 = hashBytes({ alg: "sha3-512", bytes: u8(1, 2, 3) });
      const b = hashBytes({ alg: "sha3-512", bytes: u8(1, 2, 4) });

      expect(Buffer.from(a1).toString("hex")).toBe(Buffer.from(a2).toString("hex"));
      expect(Buffer.from(a1).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
    });
  });

  describe("encodeDigest()", () => {
    it("rejects invalid bytes type", () => {
      expect(() => encodeDigest({ encoding: "hex_lower", digestBytes: null as any })).toThrow(
        /encodeDigest_invalid_bytes/
      );
    });

    it("encodes hex (lowercase) and hex_lower (lowercase)", () => {
      const b = u8(0xde, 0xad, 0xbe, 0xef);

      expect(encodeDigest({ encoding: "hex", digestBytes: b })).toBe("deadbeef");
      expect(encodeDigest({ encoding: "hex_lower", digestBytes: b })).toBe("deadbeef");
    });

    it("encodes base64 and base64url", () => {
      const b = u8(0xfb, 0xef);

      const base64 = encodeDigest({ encoding: "base64", digestBytes: b });
      const base64url = encodeDigest({ encoding: "base64url", digestBytes: b });

      // Should be decodable back to same bytes
      expect(Buffer.from(base64, "base64")).toEqual(Buffer.from(b));
      expect(Buffer.from(base64url, "base64url")).toEqual(Buffer.from(b));

      // base64url must not contain "+" or "/" (url-safe)
      expect(base64url.includes("+")).toBe(false);
      expect(base64url.includes("/")).toBe(false);
    });

    it("round-trip: hashBytes + encodeDigest yields expected hex_lower", () => {
      const bytes = Buffer.from("hello", "utf8");
      const digestBytes = hashBytes({ alg: "sha3-512", bytes });

      const hexLower = encodeDigest({ encoding: "hex_lower", digestBytes });
      const expected = crypto.createHash("sha3-512").update(bytes).digest("hex").toLowerCase();

      expect(hexLower).toBe(expected);
    });
  });
});