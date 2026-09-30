/**
 * Measures the cost of one database round trip.
 *
 * This is the number that dominated checkout time on the old hosting:
 * `placeOrder` issues roughly 26 sequential queries, so end-to-end latency is
 * ~26x whatever this prints, regardless of how fast the queries themselves are.
 *
 * On cPanel the database is on the same machine as the app, so the expected
 * reading is well under a millisecond — where Vercel-to-Neon-Singapore was
 * ~75ms. A number that is not sub-millisecond here means the connection is not
 * actually local, and is worth chasing before anything else.
 *
 * Point it at any database with DATABASE_URL, or pass a URL as the first
 * argument, to compare hosts before and after a move.
 */
import "dotenv/config";
import mariadb from "mariadb";

const url = process.argv.find((a) => a.startsWith("mysql")) ?? process.env.DATABASE_URL;

if (!url) {
    console.error("No connection string. Set DATABASE_URL or pass one as an argument.");
    process.exit(1);
}

const host = new URL(url).host;
const SAMPLES = 10;
/** Sequential round trips in one placeOrder for a 3-item cart — see order.service.ts. */
const CHECKOUT_QUERIES = 26;

const t0 = Date.now();
const connection = await mariadb.createConnection(url);
const connectMs = Date.now() - t0;

// Warm up first: the very first query on a fresh connection carries protocol
// setup that isn't representative of steady-state latency.
await connection.query("SELECT 1");

const samples = [];
for (let i = 0; i < SAMPLES; i++) {
    const s = process.hrtime.bigint();
    await connection.query("SELECT 1");
    samples.push(Number(process.hrtime.bigint() - s) / 1e6);
}
await connection.end();

// Sub-millisecond is the expected case now that the database is local, so the
// samples are read in hrtime and printed to two decimals — Date.now() would
// round every one of them to 0 and report nothing.
const round = (ms) => ms.toFixed(2);
const sorted = [...samples].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];

console.log(`host                 : ${host}`);
console.log(`TCP+auth connect     : ${connectMs} ms`);
console.log(`round-trip samples   : ${samples.map(round).join(", ")} ms`);
console.log(`median round trip    : ${round(median)} ms`);
console.log(`min / max            : ${round(sorted[0])} / ${round(sorted[sorted.length - 1])} ms`);
console.log(
    `\nprojected checkout   : ~${((median * CHECKOUT_QUERIES) / 1000).toFixed(2)}s ` +
        `(${CHECKOUT_QUERIES} sequential queries x ${round(median)} ms)`,
);
