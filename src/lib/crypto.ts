// Per-user envelope encryption for at-rest PII.
//
// We derive two independent keys from the user's API-key pair via HKDF-SHA256:
//   - aesKey  → AES-GCM 256 — randomized encryption for retrievable fields
//   - hmacKey → HMAC-SHA256 — deterministic fingerprint for dedup
//
// The maintainer of a hosted instance never sees the user's API keys (they only
// hit memory on the request path). With only D1 access an attacker holds opaque
// ciphertext + opaque fingerprints — useless without the key pair the user sends
// on every request.
//
// Versioning: the `info` strings include `:v1`. If we ever change the derivation
// (e.g. add a per-row salt), bump to `:v2` and write a migration that re-encrypts
// each row under the new derivation using the user's keys at first contact.

const FINGERPRINT_INFO = new TextEncoder().encode(
  "game-outreach-mcp:fingerprint:v1",
);
const ENCRYPTION_INFO = new TextEncoder().encode(
  "game-outreach-mcp:encryption:v1",
);

const NONCE_BYTES = 12; // AES-GCM standard nonce size

export interface UserCrypto {
  /** Encrypts plaintext to a base64 payload (nonce ‖ ciphertext+tag). */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypts a base64 payload produced by `encrypt` back to plaintext. */
  decrypt(payload: string): Promise<string>;
  /**
   * Deterministic, normalized fingerprint of `value` (lowercased + trimmed).
   * Useful as a dedup key in SQL — two callers passing the same email get the
   * same hex string, but the fingerprint reveals nothing about the input.
   */
  fingerprint(value: string): Promise<string>;
}

export async function deriveUserCrypto(
  tavilyKey: string,
  youtubeKey: string,
): Promise<UserCrypto> {
  const ikm = new TextEncoder().encode(`${tavilyKey}:${youtubeKey}`);

  const ikmKey = await crypto.subtle.importKey(
    "raw",
    ikm,
    "HKDF",
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: ENCRYPTION_INFO,
    },
    ikmKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: FINGERPRINT_INFO,
    },
    ikmKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return {
    async encrypt(plaintext: string): Promise<string> {
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        aesKey,
        new TextEncoder().encode(plaintext),
      );
      const combined = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
      combined.set(nonce, 0);
      combined.set(new Uint8Array(ciphertext), NONCE_BYTES);
      return bytesToBase64(combined);
    },

    async decrypt(payload: string): Promise<string> {
      const bytes = base64ToBytes(payload);
      if (bytes.length < NONCE_BYTES + 16) {
        throw new Error("Ciphertext too short to be valid");
      }
      const nonce = bytes.slice(0, NONCE_BYTES);
      const ciphertext = bytes.slice(NONCE_BYTES);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        aesKey,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    },

    async fingerprint(value: string): Promise<string> {
      const normalized = value.trim().toLowerCase();
      const sig = await crypto.subtle.sign(
        "HMAC",
        hmacKey,
        new TextEncoder().encode(normalized),
      );
      return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
  };
}

// btoa/atob round-trip for arbitrary bytes — Workers have these as globals,
// but they only handle ASCII strings, so we go through char codes.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
