/**
 * Verifies that a coupon's two usage limits agree (`add-admin-correction-paths`
 * group 5).
 *
 * `Coupon.usageCount` was incremented on order placement and decremented
 * nowhere, while `perCustomerLimit` counted non-cancelled orders. So a
 * cancelled order released a customer's own allowance and permanently consumed
 * the shop's — the same event meaning two different things depending on which
 * limit was asking. A merchant who ran a 100-use coupon through 30
 * cancellations saw it die at 70 real redemptions, with no explanation and no
 * endpoint able to correct the figure.
 *
 * The assertion that matters is agreement: after a cancellation, BOTH limits
 * must treat the redemption as released. Checked from the enforcement path
 * itself rather than by reading the column, since the column is deliberately
 * still incremented — a check that only compared counters would pass while the
 * behaviour stayed broken.
 *
 * NOT read-only: creates a coupon, product, customers and orders prefixed
 * `VERIFY-COUPON-USAGE`, and removes them in a `finally`.
 *
 * Run with: npx tsx scripts/verify-coupon-usage-derived.ts
 */
import {
    CouponStatus,
    CouponType,
    OrderStatus,
    ProductStatus,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { CouponService } from "../src/app/module/coupon/coupon.service";

const MARKER = "VERIFY-COUPON-USAGE";
const CODE = `${MARKER}-CODE`;

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

async function main() {
    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 100,
            status: ProductStatus.ACTIVE,
        },
    });

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Customer", phone: `${MARKER}-PHONE` },
    });

    // Limit of 2 globally so a third redemption is refused, and 2 per customer
    // so both rules are live at once and can be seen to agree.
    const coupon = await prisma.coupon.create({
        data: {
            code: CODE,
            type: CouponType.FIXED,
            value: 10,
            status: CouponStatus.ACTIVE,
            usageLimit: 2,
            perCustomerLimit: 2,
            usageCount: 0,
        },
        include: { products: true },
    });

    const cartItems = [
        { productId: product.id, quantity: 1, product: { offerPrice: 100 }, variant: null },
    ];

    /** Runs the real enforcement path; returns null on success, the message on refusal. */
    const tryRedeem = async () => {
        const fresh = await prisma.coupon.findUniqueOrThrow({
            where: { id: coupon.id },
            include: { products: true },
        });
        try {
            await CouponService.validateCouponForCart(fresh, cartItems, customer.id);
            return null;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    };

    const placeOrder = async (suffix: string, orderStatus: OrderStatus) => {
        const order = await prisma.order.create({
            data: {
                orderNumber: `${MARKER}-ORD-${suffix}`,
                customerId: customer.id,
                status: orderStatus,
                subtotal: 100,
                totalAmount: 90,
                couponCode: CODE,
            },
        });
        // Mirrors what placeOrder does to the (now deprecated) counter, so the
        // fixture reproduces the real drift rather than a tidier version of it.
        await prisma.coupon.update({
            where: { id: coupon.id },
            data: { usageCount: { increment: 1 } },
        });
        return order;
    };

    const firstAttempt = await tryRedeem();
    check(
        "a fresh coupon redeems",
        firstAttempt === null,
        firstAttempt === null ? "no refusal on the first attempt" : `refused with: ${firstAttempt}`,
    );

    await placeOrder("A", OrderStatus.DELIVERED);
    check(
        "one standing redemption still leaves room",
        (await tryRedeem()) === null,
        "1 of 2 used, so a second is allowed",
    );

    const cancelled = await placeOrder("B", OrderStatus.CANCELLED);

    // The heart of it: the counter now reads 2 (both orders incremented it) but
    // only one order still stands. Before this change the global limit read the
    // counter and refused here, while perCustomerLimit — counting the same rows
    // this now counts — would have allowed it.
    const storedAfterCancel = (
        await prisma.coupon.findUniqueOrThrow({
            where: { id: coupon.id },
            select: { usageCount: true },
        })
    ).usageCount;

    check(
        "a cancelled order frees the global allowance, as it always did the per-customer one",
        (await tryRedeem()) === null,
        `stored usageCount ${storedAfterCancel} of limit 2, but only 1 order stands — redemption allowed`,
    );

    await placeOrder("C", OrderStatus.CONFIRMED);
    const refusal = await tryRedeem();
    check(
        "two standing redemptions exhaust the coupon",
        refusal !== null && refusal.includes("usage limit"),
        `refused with: ${refusal ?? "(not refused)"}`,
    );

    // And the limit must release again when a standing order is cancelled —
    // the correction path a merchant actually relies on.
    await prisma.order.update({
        where: { id: cancelled.id },
        data: { status: OrderStatus.CANCELLED },
    });
    await prisma.order.updateMany({
        where: { orderNumber: `${MARKER}-ORD-C` },
        data: { status: OrderStatus.CANCELLED },
    });
    check(
        "cancelling a standing order releases the allowance again",
        (await tryRedeem()) === null,
        "1 order stands after the cancellation, so a redemption is allowed",
    );

    // The admin must not show a figure that disagrees with what is enforced.
    const listed = await CouponService.getAdminCoupons({ limit: 100 } as never);
    const shown = (listed.data as { code: string; usageCount: number }[]).find(
        (row) => row.code === CODE,
    );
    check(
        "the admin reports the standing count, not the stored one",
        shown?.usageCount === 1,
        `admin shows ${shown?.usageCount}, stored column is ${storedAfterCancel + 1}, standing orders 1`,
    );

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures > 0) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.order.deleteMany({ where: { orderNumber: { contains: MARKER } } });
        await prisma.coupon.deleteMany({ where: { code: { contains: MARKER } } });
        await prisma.product.deleteMany({ where: { sku: { contains: MARKER } } });
        await prisma.customer.deleteMany({ where: { phone: { contains: MARKER } } });
        await prisma.$disconnect();
    });
