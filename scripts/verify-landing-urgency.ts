/**
 * Pins the honesty of a landing page's two urgency elements.
 *
 * Both exist to make a shopper act now, which is exactly why both are dangerous:
 * a countdown that restarts per visitor, or a "65 already bought" that a
 * merchant typed in, is a lie told to every person who reads the page. A shopper
 * who catches one fabricated figure discounts every other claim on the page,
 * including the true ones — so these are not cosmetic checks.
 *
 * Covers, from openspec/changes/add-conversion-landing-page-sections:
 *   - the deadline is ONE stored instant, served as such, never a remainder
 *   - passing it closes the offer only when the merchant asked for that
 *   - the refusal is the SERVER's, so ignoring the countdown does not help
 *   - the scarcity figure is COUNTED from real orders and moves when one lands
 *   - past the target it reports "met", never a negative remainder
 *   - there is NO way to seed the count — not a column, not a payload field
 *
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-landing-urgency.ts
 */
import { LandingPageStatus, ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";
import { createLandingPageZodSchema } from "../src/app/module/landing-page/landing-page.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const thrownMessage = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (error) {
        return (error as Error).message;
    }
};

const PREFIX = "__verify_lp_urg";

const HOUR = 60 * 60 * 1000;
const past = new Date(Date.now() - HOUR);
const future = new Date(Date.now() + 24 * HOUR);

const main = async () => {
    const product = await prisma.product.create({
        data: {
            name: `${PREFIX} product`,
            slug: `${PREFIX}-product`,
            offerPrice: 500,
            status: ProductStatus.ACTIVE,
        },
        select: { id: true },
    });

    const warehouse = await prisma.warehouse.findFirst({ select: { id: true } });
    if (warehouse) {
        await prisma.stock.create({
            data: { productId: product.id, warehouseId: warehouse.id, quantity: 500 },
        });
    }

    const common = {
        status: LandingPageStatus.PUBLISHED,
        productId: product.id,
        headline: "শিরোনাম",
        bodyHtml: "<p>x</p>",
        orderForm: {
            fields: {
                fullName: { label: "নাম", required: true },
                phone: { label: "মোবাইল" },
                address: { label: "ঠিকানা" },
            },
            submitLabel: "অর্ডার",
        },
    };

    const [enforced, unenforced, scarce, plain] = await Promise.all([
        prisma.landingPage.create({
            data: { ...common, title: `${PREFIX} enforced`, slug: `${PREFIX}-enforced`, offerEndsAt: past, stopOrdersAtDeadline: true },
            select: { id: true, slug: true },
        }),
        prisma.landingPage.create({
            data: { ...common, title: `${PREFIX} unenforced`, slug: `${PREFIX}-unenforced`, offerEndsAt: past, stopOrdersAtDeadline: false },
            select: { id: true, slug: true },
        }),
        prisma.landingPage.create({
            data: { ...common, title: `${PREFIX} scarce`, slug: `${PREFIX}-scarce`, scarcityTarget: 3 },
            select: { id: true, slug: true },
        }),
        prisma.landingPage.create({
            data: { ...common, title: `${PREFIX} plain`, slug: `${PREFIX}-plain`, offerEndsAt: future },
            select: { id: true, slug: true },
        }),
    ]);

    /*
     * A DIFFERENT PHONE PER ORDER. The guest COD cap refuses a fourth pending
     * order from one number — correctly, and this script needs five. Distinct
     * shoppers is also the truthful fixture: a scarcity run counts people, and
     * one person ordering five times is not five of a hundred buyers.
     */
    const phones = ["01722222201", "01722222202", "01722222203", "01722222204", "01722222205"];
    let phoneIndex = 0;
    const nextOrderPayload = () => ({
        quantity: 1,
        deliveryOptionKey: "option-2",
        fullName: `${PREFIX} shopper`,
        phone: phones[phoneIndex++ % phones.length]!,
        address: "Test address",
    });
    const guest = { kind: "guest", ip: "127.0.0.1" } as never;

    try {
        /* ---------------------------------------------------------------- *
         * 1. The deadline is served as an INSTANT, never a remainder.
         * ---------------------------------------------------------------- */

        const read = (await LandingPageService.getPublishedBySlug(plain.slug)) as {
            offerEndsAt: Date | null;
            scarcity: unknown;
        } | null;

        check(
            "deadline: served as an absolute instant",
            read?.offerEndsAt instanceof Date,
            `type ${read?.offerEndsAt?.constructor?.name} — a precomputed remainder would be wrong the moment the page is cached`,
        );
        check(
            "deadline: two reads of the same page report the SAME instant",
            (await LandingPageService.getPublishedBySlug(plain.slug) as { offerEndsAt: Date })
                ?.offerEndsAt.getTime() === read?.offerEndsAt?.getTime(),
            "every visitor counts down to one moment, not to their own",
        );

        /* ---------------------------------------------------------------- *
         * 2. Passing the deadline closes the offer ONLY when asked.
         * ---------------------------------------------------------------- */

        const refusedOrder = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(guest, enforced.slug, nextOrderPayload()),
        );
        check(
            "deadline: an expired ENFORCED page refuses the order",
            refusedOrder !== null,
            refusedOrder ?? "it was accepted — the offer never actually closes",
        );
        check(
            "deadline: the refusal says the offer ended",
            (refusedOrder ?? "").toLowerCase().includes("ended"),
            `message: ${refusedOrder}`,
        );

        const refusedQuote = await thrownMessage(() =>
            LandingPageService.quoteLandingPageOrder(enforced.slug, {
                quantity: 1,
                deliveryOptionKey: "option-2",
            }),
        );
        check(
            "deadline: an expired ENFORCED page cannot even be quoted",
            refusedQuote !== null,
            refusedQuote ?? "it quoted — a shopper would be shown a total they cannot act on",
        );

        const acceptedPastDeadline = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(guest, unenforced.slug, nextOrderPayload()),
        );
        check(
            "deadline: an expired UNENFORCED page still accepts orders",
            acceptedPastDeadline === null,
            acceptedPastDeadline ??
                "accepted — showing urgency and closing the offer are separate merchant intents",
        );

        /* ---------------------------------------------------------------- *
         * 3. The scarcity figure is counted, and moves with real orders.
         * ---------------------------------------------------------------- */

        const scarcityOf = async (slug: string) =>
            (
                (await LandingPageService.getPublishedBySlug(slug)) as {
                    scarcity: { target: number; taken: number; remaining: number; met: boolean } | null;
                } | null
            )?.scarcity ?? null;

        const atZero = await scarcityOf(scarce.slug);
        check(
            "scarcity: reports the declared target",
            atZero?.target === 3,
            `target ${atZero?.target}`,
        );
        check(
            "scarcity: starts at the REAL count, which is zero",
            atZero?.taken === 0 && atZero?.remaining === 3,
            `${atZero?.taken} taken, ${atZero?.remaining} remaining — no seeded baseline`,
        );

        await LandingPageService.placeLandingPageOrder(guest, scarce.slug, nextOrderPayload());
        const afterOne = await scarcityOf(scarce.slug);
        check(
            "scarcity: a real order moves the figure by one",
            afterOne?.taken === 1 && afterOne?.remaining === 2,
            `${afterOne?.taken} taken, ${afterOne?.remaining} remaining`,
        );

        /* ---------------------------------------------------------------- *
         * 4. Past the target: met, never negative.
         * ---------------------------------------------------------------- */

        await LandingPageService.placeLandingPageOrder(guest, scarce.slug, nextOrderPayload());
        const atTargetMinusOne = await scarcityOf(scarce.slug);
        check(
            "scarcity: not met one short of the target",
            atTargetMinusOne?.met === false && atTargetMinusOne?.remaining === 1,
            `met=${atTargetMinusOne?.met}, remaining ${atTargetMinusOne?.remaining}`,
        );

        await LandingPageService.placeLandingPageOrder(guest, scarce.slug, nextOrderPayload());
        const atTarget = await scarcityOf(scarce.slug);
        check(
            "scarcity: met exactly at the target",
            atTarget?.met === true && atTarget?.remaining === 0,
            `met=${atTarget?.met}, remaining ${atTarget?.remaining}`,
        );

        await LandingPageService.placeLandingPageOrder(guest, scarce.slug, nextOrderPayload());
        const pastTarget = await scarcityOf(scarce.slug);
        check(
            "scarcity: past the target reports NO negative remainder",
            pastTarget?.remaining === 0 && pastTarget?.met === true,
            `${pastTarget?.taken} taken of ${pastTarget?.target}, remaining ${pastTarget?.remaining} — never -1`,
        );

        const noTarget = await scarcityOf(plain.slug);
        check(
            "scarcity: a page declaring no run reports nothing",
            noTarget === null,
            "null, so the storefront renders no indicator at all",
        );

        /* ---------------------------------------------------------------- *
         * 5. THE COUNT CANNOT BE SEEDED — not by payload, not by column.
         * ---------------------------------------------------------------- */

        const seeded = createLandingPageZodSchema.safeParse({
            title: "x",
            productId: product.id,
            headline: "x",
            bodyHtml: "<p>x</p>",
            scarcityTarget: 100,
            scarcityTakenCount: 65,
        });
        check(
            "scarcity: a seeded count is REFUSED by name, not silently stripped",
            !seeded.success,
            seeded.success
                ? "it was accepted — a client would believe it seeded the counter"
                : (seeded.error.issues[0]?.message ?? ""),
        );

        const columns = (await prisma.$queryRaw`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'LandingPage'
              AND (column_name ILIKE '%taken%' OR column_name ILIKE '%soldcount%' OR column_name ILIKE '%baseline%')
        `) as unknown[];
        check(
            "scarcity: no column exists that could hold a seeded count",
            columns.length === 0,
            `${columns.length} such column(s) — the figure must stay derived`,
        );
    } finally {
        const pages = [enforced.id, unenforced.id, scarce.id, plain.id];
        await prisma.order.deleteMany({ where: { landingPageId: { in: pages } } });
        await prisma.landingPage.deleteMany({ where: { id: { in: pages } } });
        await prisma.stock.deleteMany({ where: { productId: product.id } });
        await prisma.product.deleteMany({ where: { id: product.id } });
        await prisma.customer.deleteMany({ where: { phone: { in: phones } } });
    }
};

main()
    .then(() => {
        console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
