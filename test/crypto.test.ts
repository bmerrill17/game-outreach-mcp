import { describe, expect, it } from "vitest";
import { deriveUserCrypto } from "../src/lib/crypto";

const KEY_A_TAVILY = "tvly-AAAAAAAAAAAA";
const KEY_A_YOUTUBE = "AIzaSy-AAAAAAAAAAAAAAAAAA";
const KEY_B_TAVILY = "tvly-BBBBBBBBBBBB";
const KEY_B_YOUTUBE = "AIzaSy-BBBBBBBBBBBBBBBBBB";

describe("deriveUserCrypto encrypt/decrypt", () => {
  it("round-trips plaintext through encrypt → decrypt", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);

    const plain = "bryce@example.com";
    const ct = await c.encrypt(plain);
    expect(ct).not.toBe(plain);
    expect(ct).not.toContain("@");

    const decoded = await c.decrypt(ct);
    expect(decoded).toBe(plain);
  });

  it("handles unicode and longer payloads", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const samples = [
      "Channel ✨ Name",
      "Notes with newlines\n\nand 日本語",
      "x".repeat(2000),
    ];
    for (const sample of samples) {
      expect(await c.decrypt(await c.encrypt(sample))).toBe(sample);
    }
  });

  it("produces a different ciphertext on each call (random nonce)", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const a = await c.encrypt("same-input");
    const b = await c.encrypt("same-input");
    expect(a).not.toBe(b); // nonces differ
    expect(await c.decrypt(a)).toBe("same-input");
    expect(await c.decrypt(b)).toBe("same-input");
  });

  it("rejects ciphertext encrypted under a different user's key", async () => {
    const userA = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const userB = await deriveUserCrypto(KEY_B_TAVILY, KEY_B_YOUTUBE);

    const ct = await userA.encrypt("secret-value");
    await expect(userB.decrypt(ct)).rejects.toBeDefined();
  });

  it("rejects malformed ciphertext", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    await expect(c.decrypt("not-valid-base64!@#")).rejects.toBeDefined();
    await expect(c.decrypt("AAAA")).rejects.toThrow(/too short/);
  });
});

describe("deriveUserCrypto fingerprint", () => {
  it("is deterministic for the same input + same user", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const a = await c.fingerprint("bryce@example.com");
    const b = await c.fingerprint("bryce@example.com");
    expect(a).toBe(b);
  });

  it("is hex-encoded, 64 chars (SHA-256 = 32 bytes)", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const fp = await c.fingerprint("bryce@example.com");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes case and whitespace before hashing", async () => {
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const a = await c.fingerprint("Bryce@Example.com");
    const b = await c.fingerprint("  bryce@example.com  ");
    const canonical = await c.fingerprint("bryce@example.com");
    expect(a).toBe(canonical);
    expect(b).toBe(canonical);
  });

  it("produces different fingerprints for different users on the same input", async () => {
    const userA = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const userB = await deriveUserCrypto(KEY_B_TAVILY, KEY_B_YOUTUBE);
    const fpA = await userA.fingerprint("bryce@example.com");
    const fpB = await userB.fingerprint("bryce@example.com");
    expect(fpA).not.toBe(fpB);
  });

  it("encryption and fingerprint use independent key material", async () => {
    // Sanity check that we're not accidentally exposing the same secret two
    // ways: the fingerprint of an email should not appear inside the
    // ciphertext of that email (would imply leakage between the derivations).
    const c = await deriveUserCrypto(KEY_A_TAVILY, KEY_A_YOUTUBE);
    const fp = await c.fingerprint("bryce@example.com");
    const ct = await c.encrypt("bryce@example.com");
    expect(ct).not.toContain(fp);
  });
});
