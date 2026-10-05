/**
 * Verification for the one-time code that hands a Google sign-in to the
 * storefront.
 *
 * The properties under test are the ones whose failure would not show up as an
 * error anyone sees:
 *
 *  - a code redeems to the session it was minted for, and to a token trio that
 *    `checkAuth` would accept;
 *  - a code works ONCE — a replayed callback URL must not sign anyone in;
 *  - two concurrent redemptions of one code yield exactly one success, which is
 *    what the delete-count check in the service exists for;
 *  - expired, unknown and revoked-session codes are all refused;
 *  - the raw code is never stored, so a read of the table redeems nothing.
 *
 * See openspec/changes/fix-google-oauth-cross-domain.
 *
 * Imports the service directly — no HTTP — per the repo's testing approach.
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-google-exchange.ts
 */
import { createHash } from "node:crypto";
import { RoleId } from "../src/app/constants/role.constant";
import { prisma } from "../src/app/lib/prisma";
import { AuthService } from "../src/app/module/auth/auth.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const PREFIX = "__verify_google_exchange";

/** Mirrors the service's identifier, so the script can find and age its own rows. */
const identifierFor = (code: string) =>
    "google-exchange:" + createHash("sha256").update(code).digest("hex");

/** Resolves to "ok" or to the refusal's message, so a refusal is checkable. */
const redeem = (code: string) =>
    AuthService.redeemGoogleExchangeCode(code).then(
        (result) => ({ ok: true as const, result }),
        (error: Error) => ({ ok: false as const, message: error.message }),
    );

const main = async () => {
    // `User.id` and `Session.id` have no database default — better-auth
    // supplies them in the real flow, so a script has to mint its own.
    const user = await prisma.user.create({
        data: {
            id: `${PREFIX}_user_id`,
            name: `${PREFIX}_user`,
            email: `${PREFIX}_user@example.test`,
            emailVerified: true,
            roleId: RoleId.CUSTOMER,
        },
        select: { id: true },
    });

    const makeSession = (suffix: string) =>
        prisma.session.create({
            data: {
                id: `${PREFIX}_session_${suffix}`,
                token: `${PREFIX}_token_${suffix}`,
                userId: user.id,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
        });

    try {
        const session = await makeSession("live");

        // --- a fresh code redeems to its own session ------------------------
        const code = await AuthService.createGoogleExchangeCode(session.id);
        const first = await redeem(code);
        check(
            "fresh code redeems",
            first.ok && first.result.sessionToken === session.token,
            first.ok
                ? `sessionToken ${first.result.sessionToken === session.token ? "matches" : "DOES NOT MATCH"} the session`
                : `refused: ${first.message}`,
        );
        check(
            "redemption returns the full trio",
            first.ok && Boolean(first.result.accessToken) && Boolean(first.result.refreshToken),
            first.ok ? "access and refresh tokens present" : "no tokens",
        );

        // --- a replay is refused ----------------------------------------------
        const replay = await redeem(code);
        check("replayed code is refused", !replay.ok, replay.ok ? "REDEEMED TWICE" : replay.message);

        // --- the raw code is never stored -------------------------------------
        const storedCode = await AuthService.createGoogleExchangeCode(session.id);
        const leaked = await prisma.verification.findFirst({
            where: { OR: [{ identifier: { contains: storedCode } }, { value: { contains: storedCode } }] },
        });
        const hashed = await prisma.verification.findFirst({
            where: { identifier: identifierFor(storedCode) },
        });
        check(
            "raw code is not stored",
            !leaked && Boolean(hashed),
            leaked ? "the RAW CODE appears in a row" : "only its hash is stored",
        );

        // --- an expired code is refused ---------------------------------------
        await prisma.verification.updateMany({
            where: { identifier: identifierFor(storedCode) },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });
        const expired = await redeem(storedCode);
        check("expired code is refused", !expired.ok, expired.ok ? "EXPIRED CODE REDEEMED" : expired.message);

        // --- an unknown code is refused ---------------------------------------
        const unknown = await redeem(`${PREFIX}_never_issued`);
        check("unknown code is refused", !unknown.ok, unknown.ok ? "UNKNOWN CODE REDEEMED" : unknown.message);

        // --- a code whose session was revoked is refused ----------------------
        const doomed = await makeSession("revoked");
        const orphanCode = await AuthService.createGoogleExchangeCode(doomed.id);
        await prisma.session.delete({ where: { id: doomed.id } });
        const orphan = await redeem(orphanCode);
        check(
            "revoked-session code is refused",
            !orphan.ok,
            orphan.ok ? "REDEEMED FOR A SIGNED-OUT SESSION" : orphan.message,
        );

        // --- every refusal reads the same -------------------------------------
        const messages = new Set(
            [replay, expired, unknown, orphan].map((r) => (r.ok ? "ok" : r.message)),
        );
        check(
            "refusals are indistinguishable",
            messages.size === 1,
            `${messages.size} distinct message(s): ${[...messages].join(" | ")}`,
        );

        // --- concurrent redemption yields one success -------------------------
        const raced = await AuthService.createGoogleExchangeCode(session.id);
        const results = await Promise.all([redeem(raced), redeem(raced), redeem(raced)]);
        const wins = results.filter((r) => r.ok).length;
        check("concurrent redemption", wins === 1, `${wins} of 3 concurrent redemptions succeeded`);
    } finally {
        // Codes reference sessions by id in `value`, not by a foreign key, so
        // they are found the same way.
        await prisma.verification.deleteMany({
            where: { value: { startsWith: `${PREFIX}_session_` } },
        });
        await prisma.session.deleteMany({ where: { userId: user.id } });
        await prisma.user.deleteMany({ where: { id: user.id } });
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
};

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
