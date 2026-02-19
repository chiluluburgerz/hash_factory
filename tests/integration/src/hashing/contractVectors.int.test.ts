import { describe, it, expect } from "vitest";
import { canonicalize } from "../../../../src/hashing/canonicalJson.js";
import { frame } from "../../../../src/hashing/domain.js";

function u8ToHex(u8: Uint8Array): string {
  return Buffer.from(u8).toString("hex");
}

describe("hashing contract vectors (integration)", () => {
  it("canonicalize vectors (stable JSON text)", () => {
    const cases: Array<{ name: string; value: any; expectedJson: string }> = [
      {
        name: "sorted keys",
        value: { b: 2, a: 1, aa: 3 },
        expectedJson: "{\"a\":1,\"aa\":3,\"b\":2}",
      },
      {
        name: "nested objects + arrays",
        value: { z: [3, 2, 1], a: { b: "x", a: "y" } },
        expectedJson: "{\"a\":{\"a\":\"y\",\"b\":\"x\"},\"z\":[3,2,1]}",
      },
      {
        name: "bigint serialized as string",
        value: { n: 123n },
        expectedJson: "{\"n\":\"123\"}",
      },
      {
        name: "string escaping is JSON.stringify-stable",
        value: { s: "a\nb" },
        expectedJson: "{\"s\":\"a\\nb\"}",
      },
    ];

    for (const c of cases) {
      const bytes = canonicalize(c.value);
      const json = Buffer.from(bytes).toString("utf8");
      expect(json, c.name).toBe(c.expectedJson);
    }
  });

  it("frame vectors (stable framing bytes)", () => {
    // Format: MAGIC("hf:frame:v1") || 00 || u16be(domainLen) || domainAscii || u32be(payloadLen) || payload
    const cases: Array<{
      name: string;
      domain: string;
      payloadHex: string;
      expectedHex: string;
    }> = [
      {
        name: "simple small payload",
        domain: "hf:test",
        payloadHex: "0a0b0c",
        expectedHex:
          // MAGIC
          Buffer.from("hf:frame:v1", "utf8").toString("hex") +
          // 00
          "00" +
          // u16be(domainLen=7)
          "0007" +
          // domain ascii
          Buffer.from("hf:test", "utf8").toString("hex") +
          // u32be(payloadLen=3)
          "00000003" +
          // payload
          "0a0b0c",
      },
      {
        name: "empty payload allowed",
        domain: "hf:empty",
        payloadHex: "",
        expectedHex:
          Buffer.from("hf:frame:v1", "utf8").toString("hex") +
          "00" +
          "0008" +
          Buffer.from("hf:empty", "utf8").toString("hex") +
          "00000000",
      },
    ];

    for (const c of cases) {
      const payload = Buffer.from(c.payloadHex, "hex");
      const out = frame(c.domain, new Uint8Array(payload));
      expect(u8ToHex(out), c.name).toBe(c.expectedHex);
    }
  });
});