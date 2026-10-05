import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import "dotenv/config";
import { PrismaClient } from "../../generated/prisma/client";
import { envVars } from "../config/env";

/*
 * How raw-query results decode, because it is not the same as it was under the
 * `pg` adapter and every $queryRaw call site depends on it:
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
 *
 * Driver options cannot be passed through the adapter's second argument, which
 * only takes `database` and `onConnectionError`. They go in the connection
 * string — which is how the pool is sized below.
 */

const DEFAULT_POOL_LIMIT = 5;

/**
 * The connection string with the pool sized explicitly.
 *
 * The mariadb driver reads pool options only under its own names. Prisma's old
 * `connection_limit` is silently ignored, and the driver's defaults are 10
 * connections, all of them held open (`minimumIdle` defaults to the limit) —
 * past the per-user cap of shared cPanel MySQL. So: an explicit limit (the
 * URL's own, else `DB_POOL_LIMIT`, else 5), one idle connection kept warm, and
 * idle ones released after 60s, before a host's `wait_timeout` can kill them
 * under us.
 *
 * Done on the string rather than by building a config object so every other
 * option in the URL keeps the driver's own parsing.
 */
const poolConnectionString = (connectionString: string): string => {
    const url = new URL(connectionString);
    const params = url.searchParams;

    const legacyLimit = params.get("connection_limit");
    params.delete("connection_limit");

    if (!params.has("connectionLimit")) {
        const limit = Number(legacyLimit ?? envVars.DB_POOL_LIMIT) || DEFAULT_POOL_LIMIT;
        params.set("connectionLimit", String(limit));
    }
    if (!params.has("minimumIdle")) params.set("minimumIdle", "1");
    if (!params.has("idleTimeout")) params.set("idleTimeout", "60");

    return url.toString();
};

const adapter = new PrismaMariaDb(poolConnectionString(envVars.DATABASE_URL));

const prisma = new PrismaClient({ adapter });

export { prisma };
