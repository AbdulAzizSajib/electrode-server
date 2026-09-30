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
 * only takes `database` and `onConnectionError`. They would have to go in the
 * connection string; nothing needs that today.
 */
const adapter = new PrismaMariaDb(envVars.DATABASE_URL);

const prisma = new PrismaClient({ adapter });

export { prisma };
