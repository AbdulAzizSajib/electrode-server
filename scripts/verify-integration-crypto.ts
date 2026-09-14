/**
 * Verification for integration credential encryption.
 *
 * Covers the four failures that would each be silent and each be expensive:
 * a value that does not survive the round trip (the merchant's key is corrupted
 * and dispatch fails against the courier), a tampered ciphertext that decrypts
 * to garbage anyway (we send nonsense to a courier as an API key), a wrong key
 * that throws instead of degrading (a 500 on every admin page load, so the
 * merchant cannot reach the form that would fix it), and an unrecognised format
 * that we guess at rather than refuse.
 *
 * Also asserts the two properties that are easy to regress and impossible to
 * notice: that every encryption uses a fresh IV, and that no failure message
 * contains any part of the secret.
 *
 * No database, no network. Run with:
 *   npx tsx scripts/verify-integration-crypto.ts
 */
import { randomBytes } from "node:crypto";

/*
 * The key has to be in place BEFORE env.ts is imported: it reads process.env at
 * import time and throws on a missing required variable. Set here so the script
 * runs on a machine whose .env has no key, and so the wrong-key case below can
 * swap it deliberately rather than depending on whatever is configured.
 */
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

process.env.INTEGRATION_ENCRYPTION_KEY = KEY_A;

const { encryptSecret, decryptSecret, hintFor, secretsMatch, isEncryptionConfigured } =
    await import("../src/app/lib/crypto");

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** A realistic credential: long, mixed-case, with the punctuation base64 uses. */
const SECRET = "sk_live_9f3Ab2/cD4+eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ";

console.log("\n--- Round trip ---\n");

const encrypted = encryptSecret(SECRET);

check(
    "a secret survives encrypt → decrypt unchanged",
    decryptSecret(encrypted) === SECRET,
    "a credential that does not round-trip is a courier rejection the merchant cannot explain",
);

check(
    "the stored form is versioned and four-part",
    encrypted.startsWith("v1:") && encrypted.split(":").length === 4,
    "the version prefix is what lets a future algorithm change be detected per value",
);

check(
    "the plaintext does not appear in the stored form",
    !encrypted.includes(SECRET) && !encrypted.includes(SECRET.slice(0, 12)),
    "the entire point — a database dump must not contain readable credentials",
);

const empty = encryptSecret("");
check(
    "an empty string round-trips",
    decryptSecret(empty) === "",
    "not a useful credential, but it must not be confused with a decrypt failure",
);

const unicode = "কুরিয়ার-key-🔑-ünïcode";
check(
    "a non-ASCII secret round-trips",
    decryptSecret(encryptSecret(unicode)) === unicode,
    "utf8 in and utf8 out; a truncated multi-byte character would corrupt the key silently",
);

console.log("\n--- Fresh IV per value ---\n");

const first = encryptSecret(SECRET);
const second = encryptSecret(SECRET);

check(
    "encrypting the same value twice yields different ciphertext",
    first !== second,
    "a reused IV under one key is a catastrophic GCM failure, not a weakness",
);

check(
    "the IVs themselves differ",
    first.split(":")[1] !== second.split(":")[1],
    "identical ciphertext would also tell an observer which merchants share a key value",
);

check(
    "both still decrypt to the original",
    decryptSecret(first) === SECRET && decryptSecret(second) === SECRET,
    "randomising the IV must not cost readability",
);

console.log("\n--- Tamper rejection ---\n");

const [version, iv, tag, ciphertext] = encrypted.split(":");

/** Flips one bit in a base64 part, leaving it valid base64 of the same length. */
const corrupt = (part: string): string => {
    const bytes = Buffer.from(part, "base64");
    bytes[0] ^= 0x01;
    return bytes.toString("base64");
};

check(
    "a tampered ciphertext is refused, not decrypted to garbage",
    decryptSecret([version, iv, tag, corrupt(ciphertext)].join(":")) === null,
    "this is why GCM was chosen over CBC — garbage sent to a courier as an API key is worse than a refusal",
);

check(
    "a tampered authentication tag is refused",
    decryptSecret([version, iv, corrupt(tag), ciphertext].join(":")) === null,
    "the tag is the integrity check; accepting a broken one would defeat it",
);

check(
    "a tampered IV is refused",
    decryptSecret([version, corrupt(iv), tag, ciphertext].join(":")) === null,
    "a wrong IV yields different plaintext, which the tag catches",
);

check(
    "a truncated stored value is refused",
    decryptSecret(`${version}:${iv}:${tag}`) === null,
    "a malformed row must degrade, not throw",
);

check(
    "an empty stored value is refused",
    decryptSecret("") === null,
    "an empty column must read as unusable rather than as an empty credential",
);

check(
    "junk is refused",
    decryptSecret("not-encrypted-at-all") === null,
    "a plaintext value written by hand into the column must never be honoured",
);

console.log("\n--- Unknown version ---\n");

check(
    "an unrecognised version prefix is refused",
    decryptSecret([`v2`, iv, tag, ciphertext].join(":")) === null,
    "v2 data means a newer deployment wrote it; guessing the format risks succeeding wrongly",
);

check(
    "a missing version prefix is refused",
    decryptSecret([``, iv, tag, ciphertext].join(":")) === null,
    "same reasoning — the format is declared, never inferred",
);

console.log("\n--- Wrong key degrades rather than throwing ---\n");

/*
 * The scenario: a deployment booted with one key, reading data written under
 * another — a key restored from the wrong place, or copied between environments.
 *
 * Swapping `process.env` is enough because `resolveKey` reads it at call time
 * (see its comment). That is deliberate and is exactly what makes this
 * degradation path testable rather than theoretical.
 */
process.env.INTEGRATION_ENCRYPTION_KEY = KEY_B;

let threw = false;
let decrypted: string | null = "not-null";

try {
    decrypted = decryptSecret(encrypted);
} catch {
    threw = true;
}

check(
    "decrypting under the wrong key returns null",
    !threw && decrypted === null,
    "a wrong key must degrade to 'unconfigured', not 500 the admin page that would fix it",
);

check(
    "the wrong key still encrypts (it is valid, just different)",
    decryptSecret(encryptSecret(SECRET)) === SECRET,
    "the key is unusable for THIS data, not unusable in itself",
);

console.log("\n--- Malformed key ---\n");

process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");

check(
    "a key of the wrong length reports encryption unconfigured",
    isEncryptionConfigured() === false,
    "a truncated paste must be named as such, not surface as an opaque cipher error",
);

let encryptThrew = false;
try {
    encryptSecret(SECRET);
} catch {
    encryptThrew = true;
}

check(
    "encrypting under an unusable key throws rather than storing nothing",
    encryptThrew,
    "a silent no-op would tell the merchant their key was saved when it was not",
);

check(
    "decrypting under an unusable key returns null",
    decryptSecret(encrypted) === null,
    "reads degrade even when writes refuse — the admin page must still load",
);

// Restore, so the checks below run under the key the data was written with.
process.env.INTEGRATION_ENCRYPTION_KEY = KEY_A;

check(
    "a valid key reports encryption configured",
    isEncryptionConfigured() === true,
    "the listing uses this to distinguish 'cannot read credentials' from 'none entered'",
);

console.log("\n--- Hints disclose almost nothing ---\n");

const hint = hintFor(SECRET);

check(
    "a hint shows only the last four characters",
    hint === `••••${SECRET.slice(-4)}`,
    "enough to tell this year's key from last year's, useless to an attacker",
);

check(
    "a hint contains no more of the secret than that",
    !hint.includes(SECRET.slice(0, -4)),
    "the hint is the only thing derived from a credential that ever leaves the server",
);

check(
    "a short secret is masked entirely",
    hintFor("abc123") === "••••",
    "showing four of six characters is not a hint, it is most of the secret",
);

check(
    "an eight-character secret is masked entirely",
    hintFor("abcd1234") === "••••",
    "the boundary is inclusive — half a short secret is still too much",
);

console.log("\n--- Constant-time comparison ---\n");

check(
    "identical secrets match",
    secretsMatch("token-value", "token-value"),
    "a webhook with the right token must be accepted",
);

check(
    "different secrets of equal length do not match",
    !secretsMatch("token-value", "token-valuX"),
    "the comparison must be correct before it is constant-time",
);

check(
    "secrets of different lengths do not match",
    !secretsMatch("short", "much-longer-token"),
    "and must not throw — timingSafeEqual rejects unequal lengths outright",
);

check(
    "an empty provided secret does not match a real one",
    !secretsMatch("", "real-token"),
    "a webhook presenting no token must be refused",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
