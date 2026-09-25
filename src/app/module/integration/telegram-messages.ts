/**
 * Composes the text of each Telegram alert.
 *
 * ONE BUILDER PER EVENT, AND NO SHARED "notification → Telegram" BRIDGE. The
 * obvious shortcut would be to hook `NotificationService.notifyOwnersAndAdmins`
 * so every staff notification mirrors itself to Telegram automatically, and it
 * is wrong three times over:
 *
 *  - It would fan out EVERYTHING. That function is also called by
 *    `purchase-order.service.ts`, and `createNotification` by payment, refund,
 *    return and review. A merchant who asked for order alerts would get their
 *    phone buzzing for a product review. Subscribing to a shared write path
 *    means inheriting every future caller of it, sight unseen.
 *  - The in-app text is the WRONG TEXT. "Order ORD-2451 was placed for 12450."
 *    is right for a row in a panel that links to the order. The Telegram message
 *    has to carry the phone number and the address, because its whole purpose is
 *    to remove the trip to the panel. Forcing one string to serve both degrades
 *    both.
 *  - It would couple two independent failure domains. `NotificationService`
 *    writes rows in a path that sometimes runs inside an open transaction, and
 *    an HTTP call must not be reachable from there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES EVERY BUILDER HERE KEEPS:
 *
 *  1. **Every interpolated value goes through `escapeHtml`.** No exceptions. A
 *     product title with an `&` in it must not be able to stop a message being
 *     delivered.
 *  2. **No tag opens on one line and closes on another.** `telegram.ts`
 *     truncates an over-long message by dropping whole lines, which is only safe
 *     while that holds.
 *
 * An absent value omits its whole line rather than printing an empty label — a
 * message reading "Phone:" with nothing after it looks like a bug in the alert
 * rather than a gap in the order.
 *
 * See openspec/changes/add-telegram-notifications, design.md Decision 5.
 */
import { envVars } from "../../config/env";
import { escapeHtml } from "./telegram";

/** Prisma `Decimal`, or anything already primitive. Decimals stringify exactly;
 *  going through `Number` first would round a large total. */
type DecimalLike = { toString(): string } | number | string | null | undefined;

/**
 * No currency symbol, deliberately.
 *
 * The shop's currency lives in store settings, and reading it here would add a
 * database round trip to every alert for a shop that only ever sells in one
 * currency. The existing in-app staff notification prints the bare amount for
 * the same reason; the two should not disagree about how an order total looks.
 */
const amount = (value: DecimalLike): string => {
    if (value === null || value === undefined) return "";

    return escapeHtml(value.toString());
};

/** Joins the lines that survived, dropping the ones with nothing to say. */
const compose = (lines: (string | null)[]): string => lines.filter(Boolean).join("\n");

/**
 * A link to the record in the admin panel, or null when this deployment has not
 * been told where its panel lives.
 *
 * `ADMIN_URL` is optional (local development is covered by the CORS allowlist
 * instead), so the link is omitted rather than rendered as a broken
 * `undefined/orders/...` that a merchant would tap and blame on the alert.
 */
const adminLink = (path: string, label: string): string | null => {
    const base = envVars.ADMIN_URL?.replace(/\/+$/, "");

    if (!base) return null;

    return `<a href="${escapeHtml(`${base}${path}`)}">${escapeHtml(label)}</a>`;
};

/** One line of an order, as much of it as an alert names. */
export interface ITelegramOrderItem {
    productName: string;
    quantity: number;
    totalPrice: DecimalLike;
}

/**
 * One order, in the shape the alerts need.
 *
 * Declared here rather than imported from Prisma so that this module depends on
 * a handful of fields instead of on the whole order read — a widened
 * `ORDER_DETAIL_INCLUDE` should not be able to change what an alert says.
 */
export interface ITelegramOrder {
    id: string;
    orderNumber: string;
    totalAmount: DecimalLike;
    status?: string | null;
    landingPageTitle?: string | null;
    items?: ITelegramOrderItem[];
    payments?: { method: string }[];
    customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
    shippingAddress?: {
        fullName?: string | null;
        phone?: string | null;
        addressLine1?: string | null;
        addressLine2?: string | null;
        city?: string | null;
        state?: string | null;
        postalCode?: string | null;
    } | null;
}

/** The customer's name, preferring the one on the parcel over the one on the
 *  account — a gift order ships to someone other than the buyer. */
const recipientName = (order: ITelegramOrder): string | null => {
    const fromAddress = order.shippingAddress?.fullName?.trim();
    if (fromAddress) return fromAddress;

    const fromAccount = [order.customer?.firstName, order.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

    return fromAccount || null;
};

/** The number staff will actually dial. Same precedence as the name. */
const recipientPhone = (order: ITelegramOrder): string | null =>
    order.shippingAddress?.phone?.trim() || order.customer?.phone?.trim() || null;

/** The address on one line, skipping the parts this order does not carry. */
const deliveryAddress = (order: ITelegramOrder): string | null => {
    const address = order.shippingAddress;
    if (!address) return null;

    const parts = [
        address.addressLine1,
        address.addressLine2,
        address.city,
        address.state,
        address.postalCode,
    ]
        .map((part) => part?.trim())
        .filter(Boolean);

    return parts.length > 0 ? parts.join(", ") : null;
};

/**
 * A new order, with everything needed to make the confirmation call without
 * opening the panel.
 *
 * THE PHONE NUMBER IS REQUIRED CONTENT, NOT OPTIONAL DETAIL. In a
 * cash-on-delivery shop the first action on a new order is a confirmation call,
 * and an alert that omits the number has not saved the trip to the panel that it
 * exists to save. This does mean customer personal information reaches a third
 * party; the admin card states so, and the operating condition is that the
 * destination chat is private and staff-only.
 */
export const buildNewOrderMessage = (order: ITelegramOrder): string => {
    const name = recipientName(order);
    const phone = recipientPhone(order);
    const address = deliveryAddress(order);
    const method = order.payments?.[0]?.method;
    const link = adminLink(`/sales/orders/${order.id}`, "Open in admin");

    const items = (order.items ?? []).map(
        (item) =>
            `• ${escapeHtml(item.productName)} × ${escapeHtml(item.quantity)} — ${amount(item.totalPrice)}`,
    );

    return compose([
        `🛒 <b>New order</b> ${escapeHtml(order.orderNumber)}`,
        order.landingPageTitle ? `Campaign: ${escapeHtml(order.landingPageTitle)}` : null,
        `Total: ${amount(order.totalAmount)}${method ? ` · ${escapeHtml(method)}` : ""}`,
        "",
        ...items,
        items.length > 0 ? "" : null,
        name ? `👤 ${escapeHtml(name)}` : null,
        phone ? `📞 ${escapeHtml(phone)}` : null,
        address ? `📍 ${escapeHtml(address)}` : null,
        link,
    ]);
};

/** An order that has been cancelled, by staff or by the customer themselves. */
export const buildOrderCancelledMessage = (
    order: ITelegramOrder,
    previousStatus: string | null,
): string => {
    const name = recipientName(order);
    const link = adminLink(`/sales/orders/${order.id}`, "Open in admin");

    return compose([
        `❌ <b>Order cancelled</b> ${escapeHtml(order.orderNumber)}`,
        previousStatus
            ? `Was: ${escapeHtml(previousStatus)} → now ${escapeHtml(order.status ?? "CANCELLED")}`
            : `Now: ${escapeHtml(order.status ?? "CANCELLED")}`,
        `Total: ${amount(order.totalAmount)}`,
        name ? `👤 ${escapeHtml(name)}` : null,
        link,
    ]);
};

/** A product that has fallen to or below its low-stock threshold. */
export const buildLowStockMessage = (
    productLabel: string,
    availableQuantity: number,
    lowStockThreshold: number,
): string =>
    compose([
        `📦 <b>Low stock</b>`,
        escapeHtml(productLabel),
        `${escapeHtml(availableQuantity)} remaining (threshold ${escapeHtml(lowStockThreshold)})`,
        adminLink("/inventory/stock", "Open inventory"),
    ]);

/** A support ticket a customer has just opened. */
export const buildSupportTicketMessage = (ticket: {
    id: string;
    ticketNumber: string;
    subject: string;
    priority?: string | null;
    customer?: { firstName?: string | null; lastName?: string | null } | null;
}): string => {
    const name = [ticket.customer?.firstName, ticket.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

    return compose([
        `💬 <b>New support ticket</b> ${escapeHtml(ticket.ticketNumber)}`,
        escapeHtml(ticket.subject),
        ticket.priority ? `Priority: ${escapeHtml(ticket.priority)}` : null,
        name ? `👤 ${escapeHtml(name)}` : null,
        adminLink(`/support/tickets/${ticket.id}`, "Open ticket"),
    ]);
};
