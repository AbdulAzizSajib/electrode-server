/**
 * One-time reconciliation for the add-admin-ui-cms-section change.
 *
 * WHY THIS EXISTS
 *
 * `backfill-storefront-engagement.ts` seeded the StoreSetting chrome columns
 * when the storefront still rendered its header and footer from hardcoded
 * constants. Nothing read the seeded values, so nobody noticed they had drifted
 * from what the site actually showed:
 *
 *   - storeName was "Ecom"; the header wordmark read "Gadgets".
 *   - The announcement bar's phone and email links pointed at "/contact"; the
 *     header linked to wa.me and mailto:.
 *   - The seeded email was contact@example.com; the header showed
 *     contact@sheisite.com.
 *   - The newsletter heading said "$10 Off"; the footer rendered "৳10 Off".
 *
 * This change makes the storefront read those columns, so the drift would have
 * become a visible regression the moment it deployed.
 *
 * SAFETY
 *
 * Every field is only rewritten when it still holds the OLD SEED value. A field
 * a human has since edited does not match, so it is skipped and reported. That
 * makes this safe to run against a store whose merchant has already started
 * managing their own chrome, and safe to run twice.
 *
 * Run with: npx tsx scripts/reconcile-storefront-chrome.ts
 */
import { prisma } from "../src/app/lib/prisma";
import {
    DEFAULT_ANNOUNCEMENT_BAR,
    DEFAULT_NEWSLETTER,
    SINGLETON_ID,
    STOREFRONT_SEED_DEFAULTS,
} from "../src/app/module/store-setting/store-setting.constant";

/** What the previous backfill wrote — the only values this script will replace. */
const STALE = {
    storeName: "Ecom",
    contactEmail: "demo@example.com",
    contactPhone: "(+91) 9876-543-210",
    copyrightText: "Electrode - Electronics Store. Built with Next.js.",
    newsletterHeading: "Join Our Newsletter For $10 Off",
    announcementLinks: [
        { icon: "akar-icons:whatsapp-fill", label: "+8801782521705", href: "/contact" },
        { icon: "garden:email-stroke-16", label: "contact@example.com", href: "/contact" },
        { icon: "fa-solid:truck", label: "Track Order", href: "/track-order" },
    ],
};

const changes: string[] = [];
const skipped: string[] = [];

const reconcileScalar = <T>(
    field: string,
    current: T | null | undefined,
    stale: T,
    next: T,
    patch: Record<string, unknown>,
) => {
    if (current === next) return; // already correct
    if (current !== stale) {
        skipped.push(`${field} (currently ${JSON.stringify(current)} — not the old seed, left alone)`);
        return;
    }
    patch[field] = next;
    changes.push(`${field}: ${JSON.stringify(current)} -> ${JSON.stringify(next)}`);
};

async function main() {
    const row = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });

    if (!row) {
        console.log("No StoreSetting row yet — nothing to reconcile.");
        console.log("Run scripts/backfill-storefront-engagement.ts to seed it.");
        return;
    }

    const patch: Record<string, unknown> = {};

    reconcileScalar("storeName", row.storeName, STALE.storeName, STOREFRONT_SEED_DEFAULTS.storeName, patch);
    reconcileScalar("contactEmail", row.contactEmail, STALE.contactEmail, STOREFRONT_SEED_DEFAULTS.contactEmail, patch);
    reconcileScalar("contactPhone", row.contactPhone, STALE.contactPhone, STOREFRONT_SEED_DEFAULTS.contactPhone, patch);
    reconcileScalar("copyrightText", row.copyrightText, STALE.copyrightText, STOREFRONT_SEED_DEFAULTS.copyrightText, patch);

    // Newsletter: only the heading was wrong, so the rest of the merchant's
    // block is carried through rather than replaced wholesale.
    const newsletter = row.newsletter as { heading?: string } | null;
    if (newsletter?.heading === STALE.newsletterHeading) {
        patch.newsletter = { ...newsletter, heading: DEFAULT_NEWSLETTER.heading };
        changes.push(`newsletter.heading: "${STALE.newsletterHeading}" -> "${DEFAULT_NEWSLETTER.heading}"`);
    } else if (newsletter?.heading !== DEFAULT_NEWSLETTER.heading) {
        skipped.push(`newsletter.heading (currently ${JSON.stringify(newsletter?.heading)})`);
    }

    // Announcement links: replaced only if all three still match the old seed
    // exactly. A merchant who has added, removed or retargeted a row keeps it.
    //
    // Compared field by field rather than by JSON.stringify: Postgres returns a
    // jsonb object's keys in its own order, so a raw string comparison reported
    // "edited by a human" for rows that were byte-identical in meaning.
    const bar = row.announcementBar as { enabled?: boolean; text?: string; links?: unknown[] } | null;
    const storedLinks = (bar?.links ?? []) as { icon?: string; label?: string; href?: string }[];
    const linksAreStale =
        storedLinks.length === STALE.announcementLinks.length &&
        storedLinks.every((link, i) => {
            const expected = STALE.announcementLinks[i];
            return (
                link.icon === expected.icon &&
                link.label === expected.label &&
                link.href === expected.href
            );
        });

    if (linksAreStale) {
        patch.announcementBar = { ...bar, links: DEFAULT_ANNOUNCEMENT_BAR.links };
        changes.push(
            "announcementBar.links: repointed the phone link at wa.me and the email link at mailto:, " +
                "corrected the email address, and bound both to the store's contact details via `source`",
        );
    } else {
        skipped.push("announcementBar.links (edited since seeding, or already correct)");
    }

    if (Object.keys(patch).length === 0) {
        console.log("Nothing to change — the stored chrome already matches the storefront.");
    } else {
        await prisma.storeSetting.update({ where: { id: SINGLETON_ID }, data: patch });
        console.log("Updated:");
        for (const line of changes) console.log(`  - ${line}`);
    }

    if (skipped.length > 0) {
        console.log("\nLeft alone (not the old seed value):");
        for (const line of skipped) console.log(`  - ${line}`);
    }
}

main()
    .catch((error) => {
        console.error("Reconciliation failed:", error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
