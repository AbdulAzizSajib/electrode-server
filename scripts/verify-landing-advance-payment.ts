/**
 * Pins advance payment on the CAMPAIGN order path.
 *
 * The mechanism itself — the claim, the account check, the reused-reference
 * refusal, the staff verification — was built and verified by
 * `add-advance-payment-checkout` for the shop's checkout. This script does not
 * re-test it. It tests that the campaign path REACHES it, and that the three
 * ways a campaign can be wrong are refused:
 *
 *   - the campaign does not ask for an advance, but a claim arrives anyway
 *   - the campaign asks, but the SHOP has no accounts (so it must not ask)
 *   - the claim itself is bad — reused reference, unknown account
 *
 * And the one that is easy to assume rather than check: a campaign order with
 * an unverified claim must be BLOCKED by the same rule a shop order is, and
 * appear in the same staff queue. There must not be a second way to confirm
 * money arrived.
 *
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-landing-advance-payment.ts
 */
import {
    LandingPageStatus,
    OrderStatus,
    PaymentStatus,
    ProductStatus,
} from "../src/generated/prisma/client";
import { RoleName } from "../src/app/constants/role.constant";
import { prisma } from "../src/app/lib/prisma";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";
import { OrderService } from "../src/app/module/order/order.service";
import { PaymentService } from "../src/app/module/payment/payment.service";
import { SINGLETON_ID } from "../src/app/module/store-setting/store-setting.constant";

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

const PREFIX = "__verify_lp_adv";
const ACCOUNT_ID = "verify-bkash";

const main = async () => {
    const product = await prisma.product.create({
        data: {
            name: `${PREFIX} product`,
            slug: `${PREFIX}-product`,
            offerPrice: 1000,
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

    /*
     * The shop's own settings are MUTATED here and restored in the finally.
     * There is no other way to test "the shop has no accounts" — the whole
     * point of the feature is that the campaign reads them rather than holding
     * its own.
     */
    const settingsRow = await prisma.storeSetting.findUnique({
        where: { id: SINGLETON_ID },
        select: { checkoutConfig: true },
    });
    const originalCheckoutConfig = settingsRow?.checkoutConfig ?? null;
    const storedConfig = (originalCheckoutConfig ?? {}) as Record<string, unknown>;

    const withAccounts = {
        ...storedConfig,
        advancePayment: {
            enabled: true,
            mobileAccounts: [
                {
                    id: ACCOUNT_ID,
                    provider: "BKASH",
                    number: "01931105403",
                    accountType: "Personal",
                },
            ],
            bankAccounts: [],
        },
    };

    await prisma.storeSetting.update({
        where: { id: SINGLETON_ID },
        data: { checkoutConfig: withAccounts },
    });

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

    const [asks, plain] = await Promise.all([
        prisma.landingPage.create({
            data: {
                ...common,
                title: `${PREFIX} asks`,
                slug: `${PREFIX}-asks`,
                requiresAdvancePayment: true,
            },
            select: { id: true, slug: true },
        }),
        prisma.landingPage.create({
            data: {
                ...common,
                title: `${PREFIX} plain`,
                slug: `${PREFIX}-plain`,
                requiresAdvancePayment: false,
            },
            select: { id: true, slug: true },
        }),
    ]);

    const staff = await prisma.user.create({
        data: {
            id: `${PREFIX}_staff_id`,
            name: `${PREFIX}_staff`,
            email: `${PREFIX}_staff@example.test`,
            roleId: (await prisma.role.findFirstOrThrow({ where: { name: RoleName.ADMIN } })).id,
        },
        select: { id: true },
    });

    const phones = ["01733333301", "01733333302", "01733333303", "01733333304"];
    let phoneIndex = 0;
    const guest = { kind: "guest", ip: "127.0.0.1" } as never;

    const orderPayload = (over: Record<string, unknown> = {}) => ({
        quantity: 1,
        deliveryOptionKey: "option-2",
        fullName: `${PREFIX} shopper`,
        phone: phones[phoneIndex++ % phones.length]!,
        address: "Test address",
        ...over,
    });

    const claim = (over: Record<string, unknown> = {}) => ({
        choice: "DELIVERY_CHARGE" as const,
        accountId: ACCOUNT_ID,
        senderIdentifier: "01712345678",
        transactionId: `${PREFIX}_txn_${Math.random().toString(36).slice(2, 10)}`,
        ...over,
    });

    try {
        /* ---------------------------------------------------------------- *
         * 1. The quote states both choices, and they sum to the total.
         * ---------------------------------------------------------------- */

        const quote = await LandingPageService.quoteLandingPageOrder(asks.slug, {
            quantity: 1,
            deliveryOptionKey: "option-2",
        });

        check(
            "quote: reports both advance choices",
            Boolean(quote.advanceOptions?.DELIVERY_CHARGE && quote.advanceOptions?.FULL),
            `delivery-charge ${quote.advanceOptions?.DELIVERY_CHARGE?.advanceAmount}, full ${quote.advanceOptions?.FULL?.advanceAmount}`,
        );
        /*
         * DERIVED FROM THE QUOTE, not a hardcoded figure.
         *
         * This used to assert a literal 60 — the price the campaign authored on
         * its own `deliveryZones`. A campaign authors no delivery prices any
         * more (see openspec/changes/add-landing-page-destination-picker): the
         * charge is whatever the SHOP's delivery option stores, which a merchant
         * can change in Checkout Setting without touching a campaign. A literal
         * here would fail on any shop but the one it was written against, and
         * would say "the advance is wrong" when the real answer is "the shop
         * charges a different rate now".
         *
         * The property that actually matters survives either way: the advance a
         * shopper is asked for IS the delivery charge, whatever that charge is.
         */
        check(
            "quote: the delivery-charge choice is the SHOP option's price",
            quote.advanceOptions.DELIVERY_CHARGE.advanceAmount === quote.shippingAmount,
            `sends ${quote.advanceOptions.DELIVERY_CHARGE.advanceAmount}, delivery costs ${quote.shippingAmount}`,
        );
        for (const choice of ["DELIVERY_CHARGE", "FULL"] as const) {
            const split = quote.advanceOptions[choice];
            check(
                `quote: "${choice}" halves sum to the total`,
                Math.abs(split.advanceAmount + split.balanceAmount - quote.totalAmount) < 0.005,
                `${split.advanceAmount} + ${split.balanceAmount} vs ${quote.totalAmount}`,
            );
        }

        const plainQuote = await LandingPageService.quoteLandingPageOrder(plain.slug, {
            quantity: 1,
            deliveryOptionKey: "option-2",
        });
        check(
            "quote: a campaign NOT asking still returns the figures",
            Boolean(plainQuote.advanceOptions?.FULL),
            "so flipping the switch needs no re-fetch",
        );

        /* ---------------------------------------------------------------- *
         * 2. The claim reaches the order, and is held for verification.
         * ---------------------------------------------------------------- */

        const { order } = (await LandingPageService.placeLandingPageOrder(
            guest,
            asks.slug,
            orderPayload({ paymentMethod: "BKASH", advancePayment: claim() }),
        )) as { order: { id: string } };

        const payment = await prisma.payment.findFirst({
            where: { orderId: order.id },
            select: {
                status: true,
                method: true,
                amount: true,
                transactionId: true,
                paidToAccountId: true,
            },
        });

        check(
            "order: the claim becomes a PROCESSING payment row",
            payment?.status === PaymentStatus.PROCESSING,
            `status ${payment?.status}`,
        );
        check(
            "order: the amount is the SERVER's figure, not the client's",
            Number(payment?.amount) === quote.shippingAmount,
            `charged ${Number(payment?.amount)}, expected the ${quote.shippingAmount} the quote stated`,
        );
        check(
            "order: the account the shopper chose is recorded",
            payment?.paidToAccountId === ACCOUNT_ID,
            `account ${payment?.paidToAccountId}`,
        );

        check(
            "order: a campaign claim BLOCKS the order, by the shop's own rule",
            (await OrderService.isAwaitingPaymentVerification(order.id)) === true,
            "isAwaitingPaymentVerification is order-shaped and needed no change",
        );

        const confirmBlocked = await thrownMessage(() =>
            OrderService.updateOrderStatus(order.id, { status: OrderStatus.CONFIRMED }),
        );
        check(
            "order: confirming an unverified campaign order is refused",
            confirmBlocked !== null && confirmBlocked.toLowerCase().includes("verif"),
            confirmBlocked ?? "it was allowed through",
        );

        const queue = await PaymentService.getPendingVerifications(RoleName.ADMIN);
        check(
            "order: the campaign claim appears in the SAME staff queue",
            queue.some((row) => row.order?.id === order.id),
            "one queue for both order paths — there is no second way to confirm money arrived",
        );

        /* ---------------------------------------------------------------- *
         * 3. A claim on a campaign that does not ask is refused.
         * ---------------------------------------------------------------- */

        const before = await prisma.order.count({ where: { landingPageId: plain.id } });
        const refused = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(
                guest,
                plain.slug,
                orderPayload({ paymentMethod: "BKASH", advancePayment: claim() }),
            ),
        );
        const after = await prisma.order.count({ where: { landingPageId: plain.id } });

        check(
            "a claim on a campaign that does not ask is refused",
            refused !== null,
            refused ?? "it was accepted",
        );
        check("...and no order is created", before === after, `${before} before, ${after} after`);

        /* ---------------------------------------------------------------- *
         * 4. The inherited protections fire on this path too.
         * ---------------------------------------------------------------- */

        const reused = claim({ transactionId: `${PREFIX}_reused` });
        await LandingPageService.placeLandingPageOrder(
            guest,
            asks.slug,
            orderPayload({ paymentMethod: "BKASH", advancePayment: reused }),
        );
        const duplicate = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(
                guest,
                asks.slug,
                orderPayload({ paymentMethod: "BKASH", advancePayment: reused }),
            ),
        );
        check(
            "a reused transaction reference is refused",
            duplicate !== null,
            duplicate ?? "the same reference was accepted twice",
        );

        const unknownAccount = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(
                guest,
                asks.slug,
                orderPayload({
                    paymentMethod: "BKASH",
                    advancePayment: claim({ accountId: "not-an-account" }),
                }),
            ),
        );
        check(
            "an account the shop does not hold is refused",
            unknownAccount !== null,
            unknownAccount ?? "it was accepted",
        );

        /* ---------------------------------------------------------------- *
         * 5. The campaign cannot ask when the shop has no accounts.
         * ---------------------------------------------------------------- */

        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: {
                checkoutConfig: {
                    ...storedConfig,
                    advancePayment: { enabled: false, mobileAccounts: [], bankAccounts: [] },
                },
            },
        });

        const degraded = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(
                guest,
                asks.slug,
                orderPayload({ paymentMethod: "BKASH", advancePayment: claim() }),
            ),
        );
        check(
            "with the shop's accounts gone, the campaign refuses a claim",
            degraded !== null,
            degraded ?? "it accepted a claim naming an account that no longer exists",
        );

        const stillOrders = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(guest, asks.slug, orderPayload()),
        );
        check(
            "...but the campaign still takes cash-on-delivery orders",
            stillOrders === null,
            stillOrders ??
                "degrades to COD rather than breaking — the only safe direction to fail in",
        );

        const saveRefused = await thrownMessage(() =>
            LandingPageService.updateLandingPage(undefined, plain.id, {
                requiresAdvancePayment: true,
            }),
        );
        check(
            "turning the switch on with no shop accounts is refused at SAVE",
            saveRefused !== null,
            saveRefused ?? "it was saved, so the page would ask with nowhere to send it",
        );
    } finally {
        const pages = [asks.id, plain.id];
        await prisma.order.deleteMany({ where: { landingPageId: { in: pages } } });
        await prisma.landingPage.deleteMany({ where: { id: { in: pages } } });
        await prisma.stock.deleteMany({ where: { productId: product.id } });
        await prisma.product.deleteMany({ where: { id: product.id } });
        await prisma.customer.deleteMany({ where: { phone: { in: phones } } });
        await prisma.auditLog.deleteMany({ where: { userId: staff.id } });
        await prisma.user.deleteMany({ where: { id: staff.id } });
        // The shop's own settings, back as they were.
        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: { checkoutConfig: originalCheckoutConfig ?? undefined },
        });
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
