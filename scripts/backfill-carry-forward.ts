/**
 * One-time backfill for the carry-forward fix.
 *
 * Older invoices were created with their unpaid balance COPIED onto a newer
 * invoice as a PREVIOUS_DUE line item, while the older invoice kept its own
 * dueAmount — so the same money showed as owed on two invoices (the
 * "outstanding balance was inflated" bug).
 *
 * This script walks every active invoice that absorbed previous dues, finds the
 * source invoices via the `[id:<uuid>]` tag embedded in each PREVIOUS_DUE line
 * item, and marks each still-owing source as CARRIED_FORWARD (dueAmount = 0),
 * linking it to the invoice that absorbed it. The debt then lives in exactly
 * one place.
 *
 * Safe to run multiple times — sources already marked CARRIED_FORWARD are
 * skipped.
 *
 * Run:  npx tsx scripts/backfill-carry-forward.ts
 */
import { Prisma } from "../src/generated/prisma/client";
import {
    LineItemCategory,
    PaymentStatus,
} from "../src/generated/prisma/enums";
import { prisma } from "../src/app/lib/prisma";

const SOURCE_ID_RE = /\[id:([0-9a-fA-F-]+)\]/;

const OWED: PaymentStatus[] = [
    PaymentStatus.PARTIAL,
    PaymentStatus.DUE,
    PaymentStatus.OVERDUE,
];

async function main() {
    const now = new Date();

    // Invoices that carried previous dues and are still active (a cancelled
    // absorbing invoice should NOT keep its sources superseded).
    const absorbing = await prisma.invoice.findMany({
        where: {
            status: { in: OWED.concat(PaymentStatus.PAID) },
            lineItems: { some: { category: LineItemCategory.PREVIOUS_DUE } },
        },
        include: {
            lineItems: { where: { category: LineItemCategory.PREVIOUS_DUE } },
        },
    });

    let updated = 0;
    let skipped = 0;

    for (const inv of absorbing) {
        for (const li of inv.lineItems) {
            const match = SOURCE_ID_RE.exec(li.description ?? "");
            if (!match) {
                console.warn(
                    `  ! Could not parse source id from line item on ${inv.invoiceNumber}: "${li.description}"`,
                );
                continue;
            }
            const sourceId = match[1];

            const source = await prisma.invoice.findUnique({
                where: { id: sourceId },
                select: { id: true, invoiceNumber: true, status: true },
            });
            if (!source) {
                console.warn(
                    `  ! Source ${sourceId} referenced by ${inv.invoiceNumber} no longer exists`,
                );
                continue;
            }

            // Already carried (idempotent re-run) or not in an owing state.
            if (!OWED.includes(source.status)) {
                skipped++;
                continue;
            }

            await prisma.invoice.update({
                where: { id: source.id },
                data: {
                    status: PaymentStatus.CARRIED_FORWARD,
                    dueAmount: new Prisma.Decimal(0),
                    carriedForwardToId: inv.id,
                    carriedForwardAt: now,
                },
            });
            updated++;
            console.log(
                `  ✓ ${source.invoiceNumber} → CARRIED_FORWARD (absorbed by ${inv.invoiceNumber})`,
            );
        }
    }

    console.log(
        `\nDone. ${updated} source invoice(s) marked CARRIED_FORWARD, ${skipped} already settled/carried.`,
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
