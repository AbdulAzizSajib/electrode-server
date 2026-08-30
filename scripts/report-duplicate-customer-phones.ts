/**
 * Pre-migration report for the add-guest-cod-checkout change.
 *
 * Guest checkout merges on `Customer.phone`, which means that column needs a
 * unique constraint. This finds every row that would block it:
 *
 * 1. Exact duplicates — two customers storing byte-identical phone values.
 * 2. Format-variant duplicates — `01712345678` and `+8801712345678` are the
 *    same number and normalize together, so they collide only *after* the
 *    normalization backfill. These are invisible to a plain GROUP BY and are
 *    the ones that would otherwise fail the migration halfway through.
 * 3. Unnormalizable values — phone strings that aren't recognizable BD mobile
 *    numbers. These don't block the constraint (they stay as-is) but they can
 *    never be matched by guest checkout, so they're worth knowing about.
 *
 * Reports only. Merging is deliberately manual: two customers sharing a phone
 * may be two real people (a family phone, a shop number), and combining their
 * order histories automatically is not reversible.
 *
 * Run:  npx tsx scripts/report-duplicate-customer-phones.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { normalizePhone } from "../src/app/utils/phone";

type CustomerRow = {
    id: string;
    phone: string | null;
    firstName: string;
    lastName: string | null;
    email: string | null;
    userId: string | null;
    createdAt: Date;
};

const describe = (c: CustomerRow, orderCount: number) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
    const account = c.userId ? "registered" : "guest-only";
    return `      ${c.id}  ${name}  <${c.email ?? "no email"}>  ${account}  ${orderCount} order(s)  created ${c.createdAt.toISOString().slice(0, 10)}`;
};

async function main() {
    const customers: CustomerRow[] = await prisma.customer.findMany({
        where: { phone: { not: null } },
        select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            email: true,
            userId: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    });

    console.log(`Scanned ${customers.length} customer(s) with a phone number.\n`);

    // Order counts for every customer in one grouped query — the report is
    // most useful when it says which side of a duplicate pair carries history.
    const orderCounts = new Map(
        (
            await prisma.order.groupBy({
                by: ["customerId"],
                _count: { _all: true },
            })
        ).map((row) => [row.customerId, row._count._all]),
    );

    const byNormalized = new Map<string, CustomerRow[]>();
    const unnormalizable: CustomerRow[] = [];

    for (const customer of customers) {
        const normalized = normalizePhone(customer.phone as string);

        if (!normalized) {
            unnormalizable.push(customer);
            continue;
        }

        const bucket = byNormalized.get(normalized);
        if (bucket) bucket.push(customer);
        else byNormalized.set(normalized, [customer]);
    }

    const collisions = [...byNormalized.entries()].filter(([, rows]) => rows.length > 1);

    if (collisions.length === 0) {
        console.log("No phone collisions. The unique constraint will apply cleanly.\n");
    } else {
        console.log(
            `${collisions.length} phone number(s) held by more than one customer — each MUST be reconciled before the unique constraint can apply:\n`,
        );

        for (const [normalized, rows] of collisions) {
            const distinctStored = new Set(rows.map((r) => r.phone));
            const kind = distinctStored.size > 1 ? "format variants" : "exact duplicates";

            console.log(`  ${normalized}  (${kind}, ${rows.length} customers)`);
            for (const row of rows) {
                console.log(`    stored as "${row.phone}"`);
                console.log(describe(row, orderCounts.get(row.id) ?? 0));
            }
            console.log("");
        }
    }

    if (unnormalizable.length > 0) {
        console.log(
            `${unnormalizable.length} customer(s) hold a phone value that is not a recognizable BD mobile number.`,
        );
        console.log(
            "These do not block the migration, but guest checkout can never match them:\n",
        );
        for (const row of unnormalizable) {
            console.log(`  "${row.phone}"`);
            console.log(describe(row, orderCounts.get(row.id) ?? 0));
        }
        console.log("");
    }

    const willChange = customers.filter((c) => {
        const normalized = normalizePhone(c.phone as string);
        return normalized !== null && normalized !== c.phone;
    });

    console.log(
        `${willChange.length} customer phone value(s) will be rewritten to E.164 by the normalization backfill.`,
    );

    if (collisions.length > 0) {
        console.log("\nRESULT: reconcile the collisions above, then re-run this script.");
        process.exitCode = 1;
    } else {
        console.log("\nRESULT: safe to proceed with the normalization backfill and migration.");
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
