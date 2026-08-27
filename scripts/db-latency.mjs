/**
 * Measures the network cost of one database round trip.
 *
 * This is the number that dominates checkout time: `placeOrder` issues roughly
 * 26 sequential queries, so end-to-end latency is ~26x whatever this prints,
 * regardless of how fast the queries themselves are.
 *
 * Point it at any database with DATABASE_URL, or pass a URL as the first
 * argument, to compare regions before and after a migration.
 */
import "dotenv/config";
import pg from "pg";

const url = process.argv.find((a) => a.startsWith("postgres")) ?? process.env.DATABASE_URL;

if (!url) {
    console.error("No connection string. Set DATABASE_URL or pass one as an argument.");
    process.exit(1);
}

const host = new URL(url).host;
const SAMPLES = 10;
/** Sequential round trips in one placeOrder for a 3-item cart — see order.service.ts. */
const CHECKOUT_QUERIES = 26;

const t0 = Date.now();
const client = new pg.Client({ connectionString: url });
await client.connect();
const connectMs = Date.now() - t0;

// Warm up first: the very first query on a fresh connection carries protocol
// setup that isn't representative of steady-state latency.
await client.query("SELECT 1");

const samples = [];
for (let i = 0; i < SAMPLES; i++) {
    const s = Date.now();
    await client.query("SELECT 1");
    samples.push(Date.now() - s);
}
await client.end();

const sorted = [...samples].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];

console.log(`host                 : ${host}`);
console.log(`TCP+TLS+auth connect : ${connectMs} ms`);
console.log(`round-trip samples   : ${samples.join(", ")} ms`);
console.log(`median round trip    : ${median} ms`);
console.log(`min / max            : ${sorted[0]} / ${sorted[sorted.length - 1]} ms`);
console.log(
    `\nprojected checkout   : ~${((median * CHECKOUT_QUERIES) / 1000).toFixed(1)}s ` +
        `(${CHECKOUT_QUERIES} sequential queries x ${median} ms)`,
);
