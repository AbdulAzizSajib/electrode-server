import { PrismaClient } from "../../generated/prisma/client";
import { currentClient } from "./tenant";

/*
 * The Prisma client for the request in hand.
 *
 * ── Why this is a Proxy and not a client ──────────────────────────────────
 *
 * This module used to export one `PrismaClient`. It now exports a stand-in that
 * forwards every property access to whichever client is in scope, so that one
 * deployment can serve several demonstration shops from separate databases.
 *
 * The point of doing it here rather than at the call sites: 55 files do
 * `import { prisma } from ".../lib/prisma"`, and every service, controller and
 * script in them is unchanged by this. A service written tomorrow gets the
 * right database without knowing any of this exists. The alternative — passing
 * a client into every function — would have edited all 55 and made every future
 * service remember.
 *
 * Outside a request there is no scope, and `currentClient()` answers with the
 * `DATABASE_URL` client. That is what seeds, cron jobs and the verify scripts
 * get, and it is what a single-shop installation gets for every request too.
 * See lib/tenant.ts and openspec/changes/add-multi-demo-hosting/design.md.
 *
 * ── The one rule this imposes ─────────────────────────────────────────────
 *
 * `prisma` is no longer a value worth holding on to. Capturing it in a
 * module-scope variable and using it later would resolve against whatever scope
 * happened to be active then, not the one it was captured in. Nothing does this
 * today; import it and use it, as every existing caller already does.
 *
 * ── Raw-query decoding, unchanged by the above ────────────────────────────
 *
 *   DECIMAL  -> string   (driver default `decimalAsNumber: false`)
 *   BIGINT   -> BigInt   (driver default `bigIntAsNumber: false`)
 *   BOOLEAN  -> 1 | 0    (MySQL has no boolean type; TINYINT comes back numeric)
 *
 * The first two defaults are the ones we want and are deliberately left alone:
 * a JS number cannot hold a DECIMAL(12,2) exactly, and money is the only thing
 * DECIMAL is used for here. Call sites wrap both in `Number()` where a number
 * is what they need.
 *
 * The third has no option to change. A raw-query boolean must be read as
 * truthy/falsy or coerced — never compared with `=== true`, which silently
 * never matches. See the `sqlBoolean` decoder in report.payments.ts.
 */
const prisma = new Proxy({} as PrismaClient, {
    get: (_target, property, receiver) => {
        const client = currentClient();
        const value = Reflect.get(client, property, receiver);
        // Methods must keep their client as `this` — `$transaction`, `$queryRaw`
        // and every delegate rely on it, and an unbound function would lose it.
        return typeof value === "function" ? value.bind(client) : value;
    },
    has: (_target, property) => Reflect.has(currentClient(), property),
    ownKeys: () => Reflect.ownKeys(currentClient()),
    getOwnPropertyDescriptor: (_target, property) =>
        Reflect.getOwnPropertyDescriptor(currentClient(), property),
});

export { prisma };
