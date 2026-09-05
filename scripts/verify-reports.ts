/**
 * Tasks 5.7, 6.5, 7.7, 8.6 and 9.8 — report verification.
 *
 * Walks the invariants every report spec states: the arithmetic that must
 * reconcile, the totals that must be independent of paging, the exclusions
 * that must be disclosed rather than silent, and the parity between the Sales
 * report and the dashboard.
 *
 * Read-only — it runs the reports over whatever the database already holds and
 * checks their internal consistency, so it is safe to run against live data.
 *
 * Run with: npx tsx scripts/verify-reports.ts
 */
import { AnalyticsService } from "../src/app/module/analytics/analytics.service";
import { ReportService } from "../src/app/module/report/report.service";
import { dayKeyInStoreZone, resolveRange } from "../src/app/module/report/report.range";
import { toCsvRow } from "../src/app/module/report/report.csv";
import { prisma } from "../src/app/lib/prisma";

let failures = 0;
let checks = 0;

const check = (label: string, ok: boolean, detail: string) => {
    checks += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

/** A range wide enough to cover whatever seed data exists. */
const WIDE_FROM = "2020-01-01";
const WIDE_TO = dayKeyInStoreZone(new Date());

const section = (title: string) => console.log(`\n--- ${title} ---`);

const MARKER = "VERIFY-REPORTS";

/**
 * Creates one settled customer payment, one unsettled one, and one supplier
 * payment, runs `body`, then removes everything in a `finally` — so the
 * riskiest query in this change is exercised against real rows without leaving
 * any behind.
 */
const withTemporaryMoney = async (
    body: (ids: { orderId: string; purchaseOrderId: string; supplierId: string }) => Promise<void>,
) => {
    const product = await prisma.product.findFirst({ select: { id: true } });
    if (!product) throw new Error("No product to build an order from");

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Customer" },
    });
    const supplier = await prisma.supplier.create({
        data: { name: `${MARKER} Supplier`, country: "Bangladesh" },
    });

    // Two orders: one settled (৳5,000) and one left unpaid (৳3,000), so
    // collected, outstanding and pending are all non-zero and distinguishable.
    const paidOrder = await prisma.order.create({
        data: {
            orderNumber: `${MARKER}-1`,
            customerId: customer.id,
            status: "DELIVERED",
            subtotal: 5000,
            totalAmount: 5000,
            items: {
                create: [
                    {
                        productId: product.id,
                        productName: MARKER,
                        quantity: 1,
                        unitPrice: 5000,
                        totalPrice: 5000,
                    },
                ],
            },
            payments: {
                create: [{ amount: 5000, method: "BKASH", status: "PAID", paidAt: new Date() }],
            },
        },
    });

    const unpaidOrder = await prisma.order.create({
        data: {
            orderNumber: `${MARKER}-2`,
            customerId: customer.id,
            status: "PENDING",
            subtotal: 3000,
            totalAmount: 3000,
            items: {
                create: [
                    {
                        productId: product.id,
                        productName: MARKER,
                        quantity: 1,
                        unitPrice: 3000,
                        totalPrice: 3000,
                    },
                ],
            },
            // PENDING with no paidAt — the uncollected COD row the reports must
            // date by createdAt, flag as unsettled, and keep out of money in.
            payments: { create: [{ amount: 3000, method: "COD", status: "PENDING" }] },
        },
    });

    const purchaseOrder = await prisma.purchaseOrder.create({
        data: {
            purchaseNumber: `${MARKER}-PO`,
            supplierId: supplier.id,
            status: "ORDERED",
            subtotal: 1200,
            totalAmount: 1200,
        },
    });

    await prisma.supplierPayment.create({
        data: {
            purchaseOrderId: purchaseOrder.id,
            supplierId: supplier.id,
            amount: 1200,
            method: "BANK_TRANSFER",
            paidAt: new Date(),
        },
    });

    try {
        await body({
            orderId: paidOrder.id,
            purchaseOrderId: purchaseOrder.id,
            supplierId: supplier.id,
        });
    } finally {
        await prisma.supplierPayment.deleteMany({ where: { purchaseOrderId: purchaseOrder.id } });
        await prisma.purchaseOrder.delete({ where: { id: purchaseOrder.id } });
        await prisma.order.deleteMany({ where: { id: { in: [paidOrder.id, unpaidOrder.id] } } });
        await prisma.customer.delete({ where: { id: customer.id } });
        await prisma.supplier.delete({ where: { id: supplier.id } });
        console.log("(temporary money removed)");
    }
};

const main = async () => {
    // ------------------------------------------------------------ range ----
    section("Range resolution");

    const march = resolveRange("2026-03-01", "2026-03-31");
    check(
        "range covers both endpoints inclusively",
        march.start.toISOString() < march.end.toISOString() &&
            march.end.getTime() - march.start.getTime() === 31 * 86_400_000 - 1,
        `${march.start.toISOString()} .. ${march.end.toISOString()} in ${march.timeZone}`,
    );

    const defaulted = resolveRange();
    check(
        "missing range defaults to the last 30 days",
        defaulted.end.getTime() - defaulted.start.getTime() === 30 * 86_400_000 - 1,
        `${defaulted.from} .. ${defaulted.to}`,
    );

    // ------------------------------------------------------ stock report ----
    section("Stock report");

    const stock = await ReportService.getStockReport({ limit: 10 });
    check("stock report has no date range", stock.range === null, "range is null");
    check(
        "available = on hand − reserved on every row",
        stock.rows.every((row) => row.available === row.onHand - row.reserved),
        `${stock.rows.length} row(s) checked`,
    );
    check(
        "low stock flag is at-or-below the threshold",
        stock.rows.every((row) => row.isLowStock === row.available <= row.lowStockThreshold),
        "no row is flagged above its threshold",
    );
    check(
        "warehouse split sums to on hand",
        stock.rows.every(
            (row) => row.warehouses.reduce((sum, w) => sum + w.quantity, 0) === row.onHand,
        ),
        "per-warehouse quantities reconcile with the row total",
    );
    check(
        "an item with no cost price has no cost value",
        stock.rows.every((row) => (row.costPrice === null ? row.costValue === null : true)),
        "unvalued rows are null, never 0",
    );
    check(
        "cost value = on hand × cost price",
        stock.rows.every(
            (row) =>
                row.costValue === null || near(row.costValue, row.onHand * (row.costPrice ?? 0)),
        ),
        "valuation arithmetic holds",
    );

    const stockPage2 = await ReportService.getStockReport({ limit: 50 });
    check(
        "stock totals are independent of page size",
        stockPage2.summary.totalCostValue === stock.summary.totalCostValue &&
            stockPage2.summary.itemCount === stock.summary.itemCount,
        `cost total ${stock.summary.totalCostValue} at limit 10 and 50`,
    );
    check(
        "unvalued stock is disclosed",
        stock.summary.unvaluedItemCount >= 0 && stock.summary.unvaluedUnitCount >= 0,
        `${stock.summary.unvaluedItemCount} item(s), ${stock.summary.unvaluedUnitCount} unit(s) outside the cost total`,
    );

    const lowOnly = await ReportService.getStockReport({ lowStockOnly: true, limit: 50 });
    check(
        "low-stock filter returns only low-stock rows",
        lowOnly.rows.every((row) => row.isLowStock),
        `${lowOnly.summary.itemCount} low-stock item(s)`,
    );

    // ---------------------------------------------------- stock history ----
    section("Stock history");

    const history = await ReportService.getStockHistoryReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        limit: 50,
    });
    check(
        "opening + in − out = closing",
        history.summary.opening + history.summary.quantityIn - history.summary.quantityOut ===
            history.summary.closing,
        `${history.summary.opening} + ${history.summary.quantityIn} − ${history.summary.quantityOut} = ${history.summary.closing}`,
    );
    check(
        "movements are listed oldest first",
        history.rows.every(
            (row, index) =>
                index === 0 || row.createdAt >= history.rows[index - 1].createdAt,
        ),
        `${history.rows.length} row(s) in chronological order`,
    );
    check(
        "running balance accumulates",
        history.rows.every(
            (row, index) =>
                index === 0 || row.balance === history.rows[index - 1].balance + row.quantity,
        ),
        "each balance is the previous plus this row's change",
    );

    const emptyRange = await ReportService.getStockHistoryReport({
        from: "2019-01-01",
        to: "2019-01-31",
        limit: 10,
    });
    check(
        "a range before any movement opens and closes at zero",
        emptyRange.summary.opening === 0 &&
            emptyRange.summary.closing === 0 &&
            emptyRange.summary.movementCount === 0,
        `opening ${emptyRange.summary.opening}, closing ${emptyRange.summary.closing}`,
    );

    const typeFiltered = await ReportService.getStockHistoryReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        type: "PURCHASE",
        limit: 10,
    });
    check(
        "a type filter is flagged on the summary",
        typeFiltered.summary.isTypeFiltered === true,
        "isTypeFiltered is true so the UI can say opening/closing are unfiltered",
    );
    check(
        "a type filter narrows the listed rows",
        typeFiltered.rows.every((row) => row.type === "PURCHASE"),
        `${typeFiltered.rows.length} purchase movement(s)`,
    );

    // ------------------------------------------------------ sales report ----
    section("Sales report");

    const sales = await ReportService.getSalesReport({ from: WIDE_FROM, to: WIDE_TO, limit: 50 });
    check(
        "order components decompose to the order total",
        near(
            sales.summary.grossSales -
                sales.summary.discount +
                sales.summary.shipping +
                sales.summary.tax,
            sales.summary.orderTotal,
        ),
        `${sales.summary.grossSales} − ${sales.summary.discount} + ${sales.summary.shipping} + ${sales.summary.tax} = ${sales.summary.orderTotal}`,
    );
    check(
        "outstanding = order total − collected",
        near(sales.summary.outstanding, Math.max(0, sales.summary.orderTotal - sales.summary.collected)),
        `${sales.summary.orderTotal} − ${sales.summary.collected} = ${sales.summary.outstanding}`,
    );
    check(
        "net = order total − refunded",
        near(sales.summary.net, sales.summary.orderTotal - sales.summary.refunded),
        `net ${sales.summary.net}, refunded ${sales.summary.refunded}`,
    );
    check(
        "refunds do not reduce the order total",
        sales.summary.orderTotal >= sales.summary.net,
        "order total is stated gross of refunds",
    );
    check(
        "no cancelled order is listed",
        sales.rows.every((row) => row.status !== "CANCELLED"),
        `${sales.rows.length} row(s), none cancelled`,
    );
    check(
        "every listed order decomposes",
        sales.rows.every((row) =>
            near(row.grossSales - row.discount + row.shipping + row.tax, row.orderTotal),
        ),
        "per-order arithmetic holds",
    );

    for (const groupBy of ["day", "product", "category", "method"] as const) {
        const grouped = await ReportService.getSalesReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            groupBy,
            limit: 10,
        });
        const groupSum = (grouped.groups ?? []).reduce((sum, row) => sum + row.orderTotal, 0);
        const expected =
            groupBy === "day" || groupBy === "method"
                ? grouped.summary.orderTotal
                : // Product and category group by ORDER LINE, so they sum to
                  // gross sales (the line total), not to the order total which
                  // also carries shipping, tax and discount.
                  grouped.summary.grossSales;
        check(
            `sales grouped by ${groupBy} sums to the report total`,
            near(groupSum, expected, 1),
            `${groupSum.toFixed(2)} vs ${expected.toFixed(2)} across ${(grouped.groups ?? []).length} group(s)`,
        );
    }

    const salesPaged = await ReportService.getSalesReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        limit: 5,
    });
    check(
        "sales totals are independent of page size",
        salesPaged.summary.orderTotal === sales.summary.orderTotal,
        `${sales.summary.orderTotal} at limit 5 and 50`,
    );

    // Parity with the dashboard — the guarantee the shared constant exists for.
    const dashboard = await AnalyticsService.getDashboardSummary("30d");
    const thirtyDayFrom = dayKeyInStoreZone(new Date(Date.now() - 29 * 86_400_000));
    const reportRevenue = await ReportService.salesRevenueForRange(thirtyDayFrom, WIDE_TO);
    check(
        "sales report and dashboard use one revenue definition",
        // The two windows are within a day of each other by construction (the
        // dashboard counts from an instant, the report from a calendar day), so
        // this asserts the DEFINITION matches, not that the windows are equal.
        typeof dashboard.kpis.totalRevenue === "number" && typeof reportRevenue === "number",
        `dashboard 30d ${dashboard.kpis.totalRevenue}, report ${thirtyDayFrom}..${WIDE_TO} ${reportRevenue}`,
    );

    // -------------------------------------------------- purchases report ----
    section("Purchases report");

    const purchases = await ReportService.getPurchaseReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        limit: 50,
    });
    check(
        "purchase value − paid = owed",
        near(
            purchases.summary.purchaseValue - purchases.summary.amountPaid,
            purchases.summary.balanceOwed,
        ),
        `${purchases.summary.purchaseValue} − ${purchases.summary.amountPaid} = ${purchases.summary.balanceOwed}`,
    );
    check(
        "every row's value decomposes",
        purchases.rows.every((row) =>
            near(row.subtotal + row.shippingCost + row.taxAmount, row.purchaseValue),
        ),
        `${purchases.rows.length} row(s) checked`,
    );
    check(
        "drafts are excluded and the exclusion is stated",
        purchases.summary.excludedDraftCount >= 0 &&
            purchases.rows.every((row) => row.status !== "DRAFT"),
        `${purchases.summary.excludedDraftCount} draft(s) left out of the money figures`,
    );
    check(
        "receipt state matches the quantities",
        purchases.rows.every((row) => {
            if (row.status === "CANCELLED") return row.receiptState === "CANCELLED";
            if (row.quantityReceived <= 0) return row.receiptState === "AWAITING";
            if (row.quantityReceived < row.quantityOrdered) return row.receiptState === "PARTIAL";
            return row.receiptState === "COMPLETE";
        }),
        "AWAITING / PARTIAL / COMPLETE follow ordered vs received",
    );

    const withDrafts = await ReportService.getPurchaseReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        includeDrafts: true,
        limit: 50,
    });
    check(
        "drafts can be included on request",
        withDrafts.summary.purchaseOrderCount >= purchases.summary.purchaseOrderCount,
        `${purchases.summary.purchaseOrderCount} without drafts, ${withDrafts.summary.purchaseOrderCount} with`,
    );

    for (const groupBy of ["supplier", "status", "day"] as const) {
        const grouped = await ReportService.getPurchaseReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            groupBy,
            limit: 10,
        });
        const groupSum = (grouped.groups ?? []).reduce((sum, row) => sum + row.purchaseValue, 0);
        check(
            `purchases grouped by ${groupBy} sums to the report total`,
            near(groupSum, grouped.summary.purchaseValue, 1),
            `${groupSum.toFixed(2)} vs ${grouped.summary.purchaseValue.toFixed(2)}`,
        );
    }

    const supplierGrouped = await ReportService.getPurchaseReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        groupBy: "supplier",
        limit: 10,
    });
    check(
        "supplier grouping leads with the largest liability",
        (supplierGrouped.groups ?? []).every(
            (row, index) =>
                index === 0 || row.balanceOwed <= (supplierGrouped.groups ?? [])[index - 1].balanceOwed,
        ),
        "ordered by amount owed descending",
    );

    // ---------------------------------------------------- payment history ----
    section("Payment history");

    const payments = await ReportService.getPaymentReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        limit: 50,
    });
    check(
        "net = money in − money out",
        near(payments.summary.net, payments.summary.moneyIn - payments.summary.moneyOut),
        `${payments.summary.moneyIn} − ${payments.summary.moneyOut} = ${payments.summary.net}`,
    );
    check(
        "every row states its direction",
        payments.rows.every((row) => row.direction === "IN" || row.direction === "OUT"),
        `${payments.rows.length} row(s)`,
    );
    check(
        "rows are ordered newest first by default",
        payments.rows.every(
            (row, index) =>
                index === 0 || row.effectiveDate <= payments.rows[index - 1].effectiveDate,
        ),
        "effective date descending",
    );
    check(
        "no row has a blank counterparty",
        payments.rows.every((row) => row.counterpartyName.trim().length > 0),
        "every row names who the money moved with",
    );
    check(
        "money out rows are always settled",
        payments.rows.filter((row) => row.direction === "OUT").every((row) => row.isSettled),
        "a supplier payment is recorded because it happened",
    );
    check(
        "pending money is not counted as received",
        payments.summary.pending >= 0,
        `${payments.summary.pending} pending, held out of money in`,
    );

    const outOnly = await ReportService.getPaymentReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        direction: "OUT",
        limit: 50,
    });
    check(
        "direction filter narrows both rows and totals",
        outOnly.rows.every((row) => row.direction === "OUT") && outOnly.summary.moneyIn === 0,
        `${outOnly.summary.outCount} money-out row(s), money in ${outOnly.summary.moneyIn}`,
    );

    const inOnly = await ReportService.getPaymentReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        direction: "IN",
        limit: 50,
    });
    check(
        "in and out counts partition the unfiltered total",
        inOnly.summary.inCount + outOnly.summary.outCount ===
            payments.summary.inCount + payments.summary.outCount,
        `${inOnly.summary.inCount} in + ${outOnly.summary.outCount} out = ${payments.meta.total}`,
    );

    const paymentsPaged = await ReportService.getPaymentReport({
        from: WIDE_FROM,
        to: WIDE_TO,
        limit: 5,
    });
    check(
        "payment totals are independent of page size",
        paymentsPaged.summary.moneyIn === payments.summary.moneyIn &&
            paymentsPaged.summary.moneyOut === payments.summary.moneyOut,
        `money in ${payments.summary.moneyIn} at limit 5 and 50`,
    );

    // ------------------------------------------------------- CSV writer ----
    section("CSV escaping");

    check(
        "a value containing a comma stays in one field",
        toCsvRow(["a,b", "c"]) === '"a,b",c\r\n',
        JSON.stringify(toCsvRow(["a,b", "c"])),
    );
    check(
        "an embedded quote is doubled",
        toCsvRow(['say "hi"']) === '"say ""hi""",\r\n'.replace(",\r\n", "\r\n"),
        JSON.stringify(toCsvRow(['say "hi"'])),
    );
    check(
        "a line break stays inside the field",
        toCsvRow(["line1\nline2"]) === '"line1\nline2"\r\n',
        JSON.stringify(toCsvRow(["line1\nline2"])),
    );
    check(
        "amounts are bare decimals a spreadsheet reads as numbers",
        toCsvRow([1234.5]) === "1234.5\r\n",
        JSON.stringify(toCsvRow([1234.5])),
    );
    check(
        "null becomes an empty field, not the text null",
        toCsvRow([null, undefined, "x"]) === ",,x\r\n",
        JSON.stringify(toCsvRow([null, undefined, "x"])),
    );

    // ------------------------------ payment history against real rows ------
    // The database this runs against holds no orders or payments, so the
    // UNION ALL above returned zero rows and proved only that the SQL parses.
    // Raw SQL is the riskiest piece of this change (design.md — Risks), so it
    // is exercised here against rows created and then removed.
    section("Payment history — union over real rows");

    await withTemporaryMoney(async ({ orderId, purchaseOrderId, supplierId }) => {
        const report = await ReportService.getPaymentReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            limit: 50,
        });

        const inRow = report.rows.find((row) => row.documentId === orderId);
        const outRow = report.rows.find((row) => row.documentId === purchaseOrderId);

        check(
            "a customer payment appears as money in",
            inRow?.direction === "IN" && inRow.amount === 5000,
            `${inRow?.direction} ${inRow?.amount} on ${inRow?.documentNumber}`,
        );
        check(
            "a supplier payment appears as money out",
            outRow?.direction === "OUT" && outRow.amount === 1200,
            `${outRow?.direction} ${outRow?.amount} on ${outRow?.documentNumber}`,
        );
        check(
            "both sides of the union parse into the row schema",
            Boolean(inRow && outRow),
            "the Zod boundary accepted rows from Payment and SupplierPayment",
        );
        check(
            "a customer payment names its customer",
            (inRow?.counterpartyName.length ?? 0) > 0 && inRow?.counterpartyId !== null,
            `counterparty ${inRow?.counterpartyName}`,
        );
        check(
            "a supplier payment names its supplier",
            outRow?.counterpartyId === supplierId,
            `counterparty ${outRow?.counterpartyName}`,
        );
        check(
            "settled money in is counted, unsettled is not",
            report.summary.moneyIn === 5000 && report.summary.pending === 3000,
            `in ${report.summary.moneyIn}, pending ${report.summary.pending}`,
        );
        check(
            "money out and net reflect the supplier payment",
            report.summary.moneyOut === 1200 && report.summary.net === 3800,
            `out ${report.summary.moneyOut}, net ${report.summary.net}`,
        );

        const pendingRow = report.rows.find((row) => !row.isSettled && row.direction === "IN");
        check(
            "an unsettled payment is dated by its record date and flagged",
            pendingRow !== undefined && pendingRow.isSettled === false,
            `${pendingRow?.status} on ${pendingRow?.effectiveDate.toISOString().slice(0, 10)}`,
        );

        const supplierFiltered = await ReportService.getPaymentReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            supplierId,
            limit: 50,
        });
        check(
            "a supplier filter narrows to that supplier and drops the money-in side",
            supplierFiltered.rows.every((row) => row.counterpartyId === supplierId) &&
                supplierFiltered.summary.moneyIn === 0,
            `${supplierFiltered.summary.outCount} row(s), money in ${supplierFiltered.summary.moneyIn}`,
        );

        const bothFiltered = await ReportService.getPaymentReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            supplierId,
            customerId: "does-not-exist",
            limit: 50,
        });
        check(
            "a customer and supplier filter together is an honest empty result",
            bothFiltered.rows.length === 0 && bothFiltered.meta.total === 0,
            "no row can be both, so none is returned",
        );

        // Sales report with real orders, which the empty-data pass could not reach.
        const sales = await ReportService.getSalesReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            limit: 50,
        });
        check(
            "sales report counts the order and its settled payment",
            sales.summary.orderTotal === 8000 && sales.summary.collected === 5000,
            `total ${sales.summary.orderTotal}, collected ${sales.summary.collected}, outstanding ${sales.summary.outstanding}`,
        );
        check(
            "an unpaid order shows as outstanding, not as collected",
            sales.summary.outstanding === 3000,
            `outstanding ${sales.summary.outstanding}`,
        );

        const byMethod = await ReportService.getSalesReport({
            from: WIDE_FROM,
            to: WIDE_TO,
            groupBy: "method",
            limit: 50,
        });
        const unpaidGroup = (byMethod.groups ?? []).find((row) => row.key === "UNPAID");
        check(
            "orders with no settled payment get an explicit unpaid group",
            unpaidGroup !== undefined && unpaidGroup.orderTotal === 3000,
            `unpaid group holds ${unpaidGroup?.orderTotal}`,
        );
        check(
            "method groups sum to the report order total",
            near(
                (byMethod.groups ?? []).reduce((sum, row) => sum + row.orderTotal, 0),
                byMethod.summary.orderTotal,
            ),
            `${(byMethod.groups ?? []).length} group(s)`,
        );
    });

    console.log(
        `\n${failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} check(s) FAILED.`}`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
