/**
 * Encryption for integration credentials at rest.
 *
 * WHY THIS EXISTS. Courier API keys and the Meta CAPI access token used to live
 * in the server environment, where only a developer could set them. Selling this
 * panel to many merchants makes that untenable — every new shop would need a
 * `.env` edit and a redeploy before it could dispatch a single parcel — so the
 * credentials moved into the database, where the merchant can enter them from
 * admin UI → Integrations.
 *
 * Moving them there moves the risk with them. An environment variable lives in
 * process memory; a database row travels over the network, lands in every
 * backup, and appears in whatever a careless query selects. Encrypting the value
 * is what keeps that move from being a downgrade: a leaked dump is ciphertext,
 * and the key that opens it is somewhere else entirely (`envVars`), so an
 * attacker needs both.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMAT: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 *
 * AES-256-GCM, with a fresh random 12-byte IV per value. Two properties matter:
 *
 *  - **Authenticated.** GCM's tag means a tampered ciphertext FAILS rather than
 *    decrypting to garbage. Without it, a corrupted row would yield plausible
 *    bytes that we would then send to a courier as an API key, and the failure
 *    would surface as a confusing rejection from their API rather than as the
 *    data problem it is.
 *  - **Versioned.** The `v1:` prefix means a future algorithm change can be
 *    detected per value instead of requiring a flag day. `decryptSecret`
 *    dispatches on it and refuses anything it does not recognise.
 *
 * A fresh IV per value is not optional: GCM reusing an IV under one key is a
 * catastrophic failure, not a weakness. Nothing here ever accepts a caller's IV.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECRYPT FAILURE IS "NOT CONFIGURED", NOT A CRASH.
 *
 * `decryptSecret` returns `null` rather than throwing. The realistic cause is a
 * deployment whose `INTEGRATION_ENCRYPTION_KEY` does not match the data — a key
 * that was changed or restored from the wrong place — and the right behaviour
 * then is a courier that reports itself unconfigured and refuses to dispatch,
 * not a 500 on every admin page load. The merchant can see and fix the former;
 * the latter just looks like the panel is broken.
 *
 * Callers therefore treat `null` exactly as they treat an absent row. That is
 * also why no error message here ever includes the value, the key, or any part
 * of either — a secret that reaches a log is a secret that has leaked.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decision 2.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { envVars } from "../config/env";

/** The only format this module writes. Read support is per-version by design. */
const VERSION = "v1";

const ALGORITHM = "aes-256-gcm";

/** GCM's standard nonce width. Not a tunable — 12 bytes is what the mode expects. */
const IV_BYTES = 12;

/** GCM's authentication tag, appended by the cipher and verified on decrypt. */
const TAG_BYTES = 16;

/** AES-256 needs exactly this much key material. */
const KEY_BYTES = 32;

/** So a misconfigured deployment says so once rather than on every credential read. */
let warnedAboutKey = false;
let warnedAboutDecrypt = false;

const warnOnce = (which: "key" | "decrypt", message: string) => {
    if (which === "key") {
        if (warnedAboutKey) return;
        warnedAboutKey = true;
    } else {
        if (warnedAboutDecrypt) return;
        warnedAboutDecrypt = true;
    }

    console.warn(message);
};

/**
 * The configured key as raw bytes, or null when it is unusable.
 *
 * `env.ts` guarantees the variable is PRESENT — it is in `requireEnvVariable`,
 * so a missing one throws at import time and the process never starts. What it
 * cannot guarantee is that the value is a valid 32-byte base64 key, which is the
 * case this checks: a truncated paste or a hex key pasted where base64 was meant
 * would otherwise surface as an opaque cipher error on first use.
 *
 * Returns null rather than throwing, for the same reason `decryptSecret` does —
 * the degraded state is "no integration works", which is visible and fixable,
 * not "the server is down".
 */
const resolveKey = (): Buffer | null => {
    /*
     * `process.env` first, `envVars` second.
     *
     * They are the same value in every real deployment — `envVars` is populated
     * from `process.env` at import time. Reading the live value first is what
     * makes the wrong-key path testable: a verify script can swap the key and
     * observe the degradation, which is the behaviour this module's whole
     * null-returning contract exists for, and which is otherwise unreachable
     * because `env.ts` freezes its snapshot at import.
     *
     * `envVars` remains the fallback so the required-at-boot guarantee in
     * `env.ts` still holds: nothing here can start a process without a key.
     */
    const configured = process.env.INTEGRATION_ENCRYPTION_KEY ?? envVars.INTEGRATION_ENCRYPTION_KEY;

    if (!configured) {
        warnOnce(
            "key",
            "[crypto] INTEGRATION_ENCRYPTION_KEY is not set — no integration credential can be stored or read, so every integration will report itself unconfigured.",
        );
        return null;
    }

    const key = Buffer.from(configured, "base64");

    if (key.length !== KEY_BYTES) {
        warnOnce(
            "key",
            `[crypto] INTEGRATION_ENCRYPTION_KEY decodes to ${key.length} bytes, but AES-256 requires ${KEY_BYTES}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))". Every integration will report itself unconfigured until this is fixed.`,
        );
        return null;
    }

    return key;
};

/**
 * Encrypts one credential for storage.
 *
 * Throws — unlike `decryptSecret`, which returns null. The asymmetry is
 * deliberate: failing to decrypt is a state we must degrade through (the data is
 * already written, and the merchant needs a page that loads to fix it), while
 * failing to encrypt happens on a write we have not made yet. Swallowing that
 * would store nothing while telling the merchant their key was saved, and they
 * would discover otherwise at dispatch time.
 */
export const encryptSecret = (plaintext: string): string => {
    const key = resolveKey();

    if (!key) {
        throw new Error(
            "INTEGRATION_ENCRYPTION_KEY is missing or invalid, so credentials cannot be stored. See the server logs.",
        );
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
        ":",
    );
};

/**
 * Reads one stored credential back, or null when it cannot be read.
 *
 * Null covers every failure the same way on purpose — wrong key, tampered
 * ciphertext, unknown version, malformed row. Distinguishing them for the CALLER
 * would be useless (all four mean "this credential is unusable") and actively
 * unhelpful for an attacker-facing surface, where a distinct error per cause is
 * an oracle. The distinction that matters goes to the LOG, once, where an
 * operator can act on it.
 */
export const decryptSecret = (stored: string): string | null => {
    const key = resolveKey();
    if (!key) return null;

    const parts = stored.split(":");

    if (parts.length !== 4) {
        warnOnce(
            "decrypt",
            "[crypto] A stored integration credential is not in the expected format and cannot be read. The affected integration will report itself unconfigured; re-enter its credentials in the admin panel.",
        );
        return null;
    }

    const [version, ivPart, tagPart, ciphertextPart] = parts;

    // Dispatch on the version rather than assuming. An unknown prefix means data
    // written by a NEWER deployment than this one — a rollback — and guessing
    // the format would at best fail confusingly and at worst succeed wrongly.
    if (version !== VERSION) {
        warnOnce(
            "decrypt",
            `[crypto] A stored integration credential uses format "${version}", which this server does not understand. It was probably written by a newer deployment.`,
        );
        return null;
    }

    try {
        const iv = Buffer.from(ivPart, "base64");
        const tag = Buffer.from(tagPart, "base64");
        const ciphertext = Buffer.from(ciphertextPart, "base64");

        // Checked before the cipher sees them: createDecipheriv throws on a
        // wrong-length IV, and setAuthTag on a wrong-length tag, both with
        // messages that read like internal errors rather than corrupt data.
        if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
            warnOnce(
                "decrypt",
                "[crypto] A stored integration credential has a malformed IV or authentication tag and cannot be read.",
            );
            return null;
        }

        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        // `final()` is where GCM verifies the tag — it throws when the ciphertext
        // was tampered with or the key is wrong. That throw is the whole point of
        // choosing an authenticated mode, so it must not be bypassed.
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        /*
         * Overwhelmingly this is the wrong key: a deployment whose
         * INTEGRATION_ENCRYPTION_KEY does not match the data it is reading.
         *
         * The message says what to check and names no value — not the key, not
         * the ciphertext, not their lengths. It is logged once because the
         * alternative is one line per credential per request.
         */
        warnOnce(
            "decrypt",
            "[crypto] A stored integration credential could not be decrypted. The usual cause is an INTEGRATION_ENCRYPTION_KEY that does not match the stored data. Affected integrations will report themselves unconfigured until the correct key is restored or the credentials are re-entered.",
        );
        return null;
    }
};

/**
 * Whether the encryption key is usable at all.
 *
 * For the integrations listing, which should be able to say "this deployment
 * cannot read its credentials" rather than reporting every integration as merely
 * unconfigured — the two look identical to a merchant otherwise, and only one of
 * them is fixed by typing the credentials in again.
 */
export const isEncryptionConfigured = (): boolean => resolveKey() !== null;

/**
 * The last four characters of a secret, for showing which value is stored
 * without disclosing it.
 *
 * This is the ONLY thing derived from a credential that ever leaves the server.
 * Four characters is short enough to be useless to an attacker and long enough
 * for a merchant to tell "the key I just pasted" from "the one from last year",
 * which is the entire question the admin needs answered.
 *
 * Short secrets are masked entirely rather than partially revealed — a six
 * character value showing four of them is not a hint, it is most of the secret.
 */
export const hintFor = (plaintext: string): string => {
    if (plaintext.length <= 8) return "••••";
    return `••••${plaintext.slice(-4)}`;
};

/**
 * Constant-time string comparison, for webhook tokens.
 *
 * Mirrors `courier.guard.ts`, which already compares this way and for the same
 * reason: a byte-by-byte comparison that returns early leaks how much of a
 * guessed token was right, which turns an unguessable secret into one that can
 * be discovered a character at a time.
 *
 * Lengths are compared separately, and a mismatch still burns a comparison so
 * that a wrong-length guess is not measurably faster than a right-length one.
 */
export const secretsMatch = (provided: string, expected: string): boolean => {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    if (a.length !== b.length) {
        timingSafeEqual(b, b);
        return false;
    }

    return timingSafeEqual(a, b);
};
