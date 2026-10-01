import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import "dotenv/config";
import { PrismaClient } from "../../generated/prisma/client";
import { envVars } from "../config/env";

/**
 * Which database serves the request in hand.
 *
 * ── What this is for, and what it is not ──────────────────────────────────
 *
 * One deployment — the merchant's demo host — presents several independent
 * demonstration shops, one per subdomain, each with its own database. Every
 * other deployment, including the merchant's own site and every client's
 * installation, runs a single shop and never configures a demo map. For those,
 * everything here resolves to the one client built from `DATABASE_URL` and the
 * mechanism is inert.
 *
 * That asymmetry is the design, not an accident of it: single-shop is the
 * DEFAULT path, and multi-demo is the opt-in. See
 * openspec/changes/add-multi-demo-hosting/design.md, Decisions 1 and 3.
 *
 * THIS IS NOT MULTI-TENANCY. Paying clients get their own cPanel, their own
 * database and their own deployment. Nothing here is a step toward shared
 * production data, and the demo key is explicitly not a security boundary —
 * see `resolveDemoKey` below.
 */

/** The header a caller names a demo with. Kept in one place so both clients can quote it. */
export const DEMO_KEY_HEADER = "x-demo-key";

/**
 * The scope key used when no demo is named.
 *
 * Exported because the storefront's cache tags are suffixed with the demo key,
 * and a single-shop installation must produce a stable suffix rather than an
 * empty one — `products:default`, never `products:`.
 */
export const DEFAULT_DEMO_KEY = "default";

/**
 * Demo key → connection string, read straight from the environment rather than
 * through `envVars`.
 *
 * Deliberately not added to the required-variable list in `config/env.ts`: that
 * list is what a deployment MUST provide, and a client installation must keep
 * requiring exactly what it required before demo hosting existed. Reading
 * `process.env` here is what keeps that promise structural rather than
 * remembered.
 *
 * A malformed value is a misconfiguration of the one machine that sets it, so
 * it throws at startup rather than degrading to single-shop and leaving the
 * merchant wondering why every demo shows the same catalogue.
 */
const parseDemoMap = (): Map<string, string> => {
    const raw = process.env.DEMO_DATABASES?.trim();
    if (!raw) return new Map();

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(
            "DEMO_DATABASES is set but is not valid JSON. Expected an object of " +
                'demo key to connection string, e.g. {"fashion":"mysql://..."}.',
        );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("DEMO_DATABASES must be a JSON object of demo key to connection string.");
    }

    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== "string" || value.length === 0) {
            throw new Error(`DEMO_DATABASES entry "${key}" is not a connection string.`);
        }
        if (key === DEFAULT_DEMO_KEY) {
            throw new Error(
                `DEMO_DATABASES may not define "${DEFAULT_DEMO_KEY}" — that key names the ` +
                    "DATABASE_URL shop, and shadowing it would make the fallback unreachable.",
            );
        }
        map.set(key.toLowerCase(), value);
    }
    return map;
};

const demoMap = parseDemoMap();

/** True only on the demo host. Every other deployment reads false. */
export const hasDemoMap = demoMap.size > 0;

/** The demo keys this deployment serves, for diagnostics and verification scripts. */
export const demoKeys = (): string[] => [...demoMap.keys()];

const buildClient = (connectionString: string): PrismaClient =>
    new PrismaClient({ adapter: new PrismaMariaDb(connectionString) });

/**
 * The client every deployment has, built eagerly because every deployment uses
 * it — as the only shop on a single-shop installation, and as the fallback for
 * an unkeyed or unknown-keyed request on the demo host.
 */
const defaultClient = buildClient(envVars.DATABASE_URL);

/**
 * One client per database, built on first use.
 *
 * Not built at startup: a pool for a demo nobody has visited is connections
 * spent for nothing, and shared MySQL accounts cap them. Each demo's URL should
 * carry `?connection_limit=2` for the same reason — see CPANEL-DEPLOY.md.
 */
const clients = new Map<string, PrismaClient>([[DEFAULT_DEMO_KEY, defaultClient]]);

const clientFor = (key: string): PrismaClient => {
    const existing = clients.get(key);
    if (existing) return existing;

    const connectionString = demoMap.get(key);
    if (!connectionString) return defaultClient;

    const client = buildClient(connectionString);
    clients.set(key, client);
    return client;
};

interface DemoScope {
    key: string;
    client: PrismaClient;
}

/**
 * The scope the request middleware enters.
 *
 * AsyncLocalStorage rather than a parameter threaded through every service,
 * because the store follows `await` boundaries: a service that fans out with
 * `Promise.all`, and a transaction that resumes after a slow query, both stay
 * on their own demo's client. Two concurrent requests for different demos never
 * see each other's store.
 */
const storage = new AsyncLocalStorage<DemoScope>();

/**
 * Normalises whatever a caller sent into a key this deployment serves.
 *
 * Returns the default key when the header is absent, when no demo map is
 * configured, or when the key is unknown. Falling back rather than rejecting is
 * what lets a storefront send the header unconditionally: a client installation
 * receiving it must behave exactly as if it had not.
 *
 * THE KEY IS ROUTING, NOT AUTHORISATION. Any caller may name any configured
 * demo and be served it. That is acceptable only because a deployment carrying
 * a demo map holds demonstration data and nothing else. If this ever has to
 * separate one client's real data from another's, this design is the wrong one
 * and should be replaced, not hardened.
 */
export const resolveDemoKey = (rawHeader: unknown): string => {
    if (!hasDemoMap) return DEFAULT_DEMO_KEY;

    const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof value !== "string") return DEFAULT_DEMO_KEY;

    const key = value.trim().toLowerCase();
    return demoMap.has(key) ? key : DEFAULT_DEMO_KEY;
};

/** Runs `fn` with `key`'s database in scope. */
export const runInDemoScope = <T>(key: string, fn: () => T): T =>
    storage.run({ key, client: clientFor(key) }, fn);

/**
 * The client for the request in hand, or the default when there is no request.
 *
 * The no-scope answer is load-bearing rather than defensive: seeds, cron jobs
 * and all 66 `verify-*` scripts run outside any request, and every one of them
 * means the `DATABASE_URL` shop.
 */
export const currentClient = (): PrismaClient => storage.getStore()?.client ?? defaultClient;

/**
 * Closes every pool this process opened.
 *
 * For scripts, not for the server: a long-lived server holds its pools until it
 * dies. A script that does not call this keeps the event loop alive on the demo
 * pools and never exits — it finishes its work, prints its results, and then
 * hangs until something kills it, which reads as a failure.
 */
export const disposeClients = async (): Promise<void> => {
    await Promise.all([...clients.values()].map((client) => client.$disconnect()));
    clients.clear();
};
/** The demo key in scope, or the default. Used where a name is needed rather than a client. */
export const currentDemoKey = (): string => storage.getStore()?.key ?? DEFAULT_DEMO_KEY;
