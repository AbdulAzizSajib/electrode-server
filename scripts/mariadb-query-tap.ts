/**
 * Counts database round trips at the driver adapter, below Prisma.
 *
 * The verify scripts assert how many statements an operation costs, which is
 * only meaningful if the count is taken where the statements actually leave the
 * process. Counting inside Prisma would miss the BEGIN and COMMIT an emulated
 * upsert emits, and would hide a nested include that turns into a second query.
 *
 * ── Where the hook goes, and why not where it looks like it should ────────
 *
 * Under `pg` this was one line: patch `pg.Client.prototype.query`.
 *
 * The obvious equivalent — wrapping `mariadb.createPool` so every pool the
 * adapter builds is instrumented — DOES NOT WORK, and fails silently, which is
 * worse than failing loudly. `@prisma/adapter-mariadb`'s ESM build reaches the
 * driver with `import * as mariadb from "mariadb"`. A namespace object built
 * over a CommonJS module snapshots its properties, so a `createPool` replaced
 * on the CJS exports object afterwards is invisible to it: the tap installs
 * cleanly, never throws, and reports zero for everything. A round-trip budget
 * asserted against zero passes no matter how many queries ran.
 *
 * So the hook goes one level up, on the adapter's own queryable base class —
 * `queryRaw` and `executeRaw` are the two methods every statement passes
 * through, and `MariaDbTransaction` extends the same base, so a transaction's
 * BEGIN, its statements and its COMMIT are all counted without a second patch.
 * The class is reached through `PrismaMariaDb.prototype.connect`, whose return
 * value is the adapter instance.
 *
 * ── Ordering requirement ──────────────────────────────────────────────────
 *
 * `install()` MUST run before `src/app/lib/prisma` is imported, because that
 * module constructs the adapter at import time. Both callers import Prisma
 * dynamically, after installing, for exactly this reason.
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

export interface TappedQuery {
    /** Milliseconds since the tap's clock was last reset. */
    at: number;
    /** The statement text. */
    sql: string;
}

let onQuery: ((query: TappedQuery) => void) | null = null;
let clock = 0;
let installed = false;

/**
 * The adapter passes `{ sql, args, argTypes }`. A bare string is accepted too,
 * and an unrecognised shape yields an empty string rather than throwing: this
 * is instrumentation, and it must never be the reason a verification run fails.
 */
const sqlOf = (arg: unknown): string => {
    if (typeof arg === "string") return arg;
    if (arg && typeof arg === "object" && "sql" in arg) {
        const { sql } = arg as { sql?: unknown };
        if (typeof sql === "string") return sql;
    }
    return "";
};

type Method = (this: unknown, query: unknown, ...rest: unknown[]) => unknown;

/**
 * Wraps `queryRaw` and `executeRaw` on the prototype the adapter instance
 * inherits them from — the shared `MariaDbQueryable` base, which the pool-backed
 * adapter and the transaction object both extend.
 *
 * Returns false when neither method is found, so a future adapter release that
 * moves them is caught by the caller instead of silently counting nothing.
 */
const patchQueryable = (instance: object): boolean => {
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    // queryRaw/executeRaw live on the BASE class, one step further up than the
    // adapter's own prototype.
    const base = Object.getPrototypeOf(proto) as Record<string, unknown>;
    let patched = 0;

    for (const target of [proto, base]) {
        for (const name of ["queryRaw", "executeRaw"]) {
            if (typeof target[name] !== "function") continue;
            if ((target[name] as { __tapped?: boolean }).__tapped) { patched += 1; continue; }

            const original = target[name] as Method;
            const wrapper = function (this: unknown, query: unknown, ...rest: unknown[]) {
                onQuery?.({ at: performance.now() - clock, sql: sqlOf(query) });
                return original.call(this, query, ...rest);
            };
            (wrapper as { __tapped?: boolean }).__tapped = true;
            target[name] = wrapper;
            patched += 1;
        }
        if (patched > 0) break;
    }

    return patched > 0;
};

/**
 * Starts reporting every statement the adapter issues.
 *
 * Safe to call more than once; the second call replaces the callback rather
 * than double-wrapping, so a statement is never counted twice.
 *
 * Throws if the methods it expects are missing. That is deliberate: a tap that
 * quietly counts nothing turns every round-trip assertion into a no-op.
 */
export const install = (handler: (query: TappedQuery) => void): void => {
    onQuery = handler;
    if (installed) return;

    const proto = PrismaMariaDb.prototype as unknown as Record<string, unknown>;
    const connect = proto.connect as (this: unknown) => Promise<object>;

    if (typeof connect !== "function") {
        throw new Error("mariadb-query-tap: PrismaMariaDb.prototype.connect is missing — the adapter's shape changed.");
    }

    proto.connect = async function (this: unknown) {
        const adapter = await connect.call(this);
        if (!patchQueryable(adapter)) {
            throw new Error(
                "mariadb-query-tap: no queryRaw/executeRaw found on the adapter — round-trip counts would be silently zero.",
            );
        }
        return adapter;
    };

    installed = true;
};

/** Restarts the tap's clock, so `at` is measured from here. */
export const resetClock = (): void => {
    clock = performance.now();
};

/**
 * Reads the table a statement touches, for the human-readable trace.
 *
 * MySQL quotes identifiers with backticks where PostgreSQL used double quotes,
 * and Prisma emits them quoted, so both the quoted and bare forms are matched —
 * the bare one because this repo's hand-written raw SQL leaves identifiers
 * unquoted wherever they are not reserved words.
 */
export const tableOf = (sql: string): string =>
    sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+`?(\w+)`?/i)?.[1] ?? "";
