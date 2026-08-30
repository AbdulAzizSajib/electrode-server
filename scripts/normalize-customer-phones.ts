/**
 * Normalizes every `Customer.phone` to E.164 for the add-guest-cod-checkout
 * change. Idempotent — re-running it is a no-op once values are canonical.
 *
 * Must run BEFORE the migration that makes `Customer.phone` unique: guest
 * checkout looks customers up by normalized phone, so a row still stored as
 * `01712345678` would never be found, and the guest would get a brand-new
 * customer record while the old row silently holds the same number.
 *
 * Values that are not recognizable BD mobile numbers are left untouched and
 * reported — rewriting them would be guesswork.
 *
 * Run:  npx tsx scripts/normalize-customer-phones.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { normalizePhone } from "../src/app/utils/phone";

async function main() {
    const customers = await prisma.customer.findMany({
        where: { phone: { not: null } },
        select: { id: true, phone: true },
    });

    let changed = 0;
    let alreadyCanonical = 0;
    const skipped: { id: string; phone: string }[] = [];

    for (const customer of customers) {
        const current = customer.phone as string;
        const normalized = normalizePhone(current);

        if (!normalized) {
            skipped.push({ id: customer.id, phone: current });
            continue;
        }

        if (normalized === current) {
            alreadyCanonical += 1;
            continue;
        }

        await prisma.customer.update({
            where: { id: customer.id },
            data: { phone: normalized },
        });

        console.log(`  ${customer.id}: "${current}" -> "${normalized}"`);
        changed += 1;
    }

    console.log(
        `\nNormalized ${changed} phone value(s); ${alreadyCanonical} already canonical.`,
    );

    if (skipped.length > 0) {
        console.log(
            `\n${skipped.length} value(s) left untouched (not recognizable BD mobile numbers):`,
        );
        for (const row of skipped) {
            console.log(`  ${row.id}: "${row.phone}"`);
        }
        console.log("Guest checkout will never match these. Fix them by hand if they matter.");
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
