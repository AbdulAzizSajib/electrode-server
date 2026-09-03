import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    ICreateShippingRulePayload,
    IShippingPlaceInput,
    IUpdateShippingRulePayload,
} from "./shipping-rule.interface";

/**
 * Places ordered most-specific-first, which is also the order the matcher wants:
 * a place naming a region beats one naming a country, which beats the catch-all.
 * Postgres sorts NULLs last by default, so a plain ascending sort on
 * country-then-state already produces that.
 */
const SHIPPING_RULE_INCLUDE = {
    places: { orderBy: [{ country: "asc" as const }, { state: "asc" as const }] },
};

const ensureNameIsFree = async (name: string, excludeId?: string) => {
    const clash = await prisma.shippingRule.findFirst({
        where: {
            name: { equals: name.trim(), mode: "insensitive" },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { name: true },
    });

    if (clash) {
        throw new AppError(status.CONFLICT, `A shipping rule named "${clash.name}" already exists`);
    }
};

/**
 * Rejects places that could not be matched sensibly.
 *
 * A region without a country is meaningless — "Dhaka" in which country? — and
 * two places covering the same destination would make matching a coin toss,
 * so the more specific one would be ignored at random.
 */
const ensurePlacesAreCoherent = (places: IShippingPlaceInput[]) => {
    const seen = new Set<string>();

    for (const place of places) {
        if (place.state && !place.country) {
            throw new AppError(
                status.BAD_REQUEST,
                `Place "${place.name ?? place.state}" names a region but no country`,
            );
        }

        const key = `${place.country ?? "*"}|${place.state ?? "*"}`;
        if (seen.has(key)) {
            throw new AppError(
                status.BAD_REQUEST,
                "Two places cover the same destination",
            );
        }
        seen.add(key);

        if (place.offersPickup === false && place.pickupPrice) {
            throw new AppError(
                status.BAD_REQUEST,
                `Place "${place.name ?? key}" sets a pickup price but does not offer pickup`,
            );
        }
    }
};

const toPlaceData = (place: IShippingPlaceInput) => ({
    name: place.name?.trim() || null,
    country: place.country || null,
    state: place.state || null,
    price: place.price,
    deliveryDays: place.deliveryDays ?? 0,
    offersPickup: place.offersPickup ?? false,
    pickupPrice: place.pickupPrice ?? 0,
});

const createShippingRule = async (userId: string, payload: ICreateShippingRulePayload) => {
    await ensureNameIsFree(payload.name);
    ensurePlacesAreCoherent(payload.places);

    const rule = await prisma.shippingRule.create({
        data: {
            name: payload.name.trim(),
            places: { create: payload.places.map(toPlaceData) },
        },
        include: SHIPPING_RULE_INCLUDE,
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "ShippingRule", rule.id, {
        newData: rule,
    });

    return rule;
};

/**
 * Reconciles a rule's places: those with an `id` are updated, those without are
 * created, and existing places absent from the payload are deleted.
 */
const syncShippingPlaces = async (
    tx: Prisma.TransactionClient,
    shippingRuleId: string,
    places: IShippingPlaceInput[],
) => {
    const existing = await tx.shippingPlace.findMany({
        where: { shippingRuleId },
        select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const keepIds = new Set(places.filter((p) => p.id).map((p) => p.id as string));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
        await tx.shippingPlace.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const place of places) {
        if (place.id) {
            if (!existingIds.has(place.id)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Place ${place.id} does not belong to this shipping rule`,
                );
            }
            await tx.shippingPlace.update({ where: { id: place.id }, data: toPlaceData(place) });
        } else {
            await tx.shippingPlace.create({ data: { ...toPlaceData(place), shippingRuleId } });
        }
    }
};

const updateShippingRule = async (
    userId: string,
    id: string,
    payload: IUpdateShippingRulePayload,
) => {
    const existing = await prisma.shippingRule.findUnique({
        where: { id },
        include: SHIPPING_RULE_INCLUDE,
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Shipping rule not found");
    }

    if (payload.name) {
        await ensureNameIsFree(payload.name, id);
    }

    if (payload.places) {
        // The zod schema already requires at least one, but an update sending
        // an empty array through another path would otherwise leave a rule that
        // matches nowhere and makes its products undeliverable.
        if (payload.places.length === 0) {
            throw new AppError(status.BAD_REQUEST, "A shipping rule needs at least one place");
        }
        ensurePlacesAreCoherent(payload.places);
    }

    const updated = await prisma.$transaction(async (tx) => {
        if (payload.name) {
            await tx.shippingRule.update({ where: { id }, data: { name: payload.name.trim() } });
        }

        if (payload.places) {
            await syncShippingPlaces(tx, id, payload.places);
        }

        return tx.shippingRule.findUniqueOrThrow({ where: { id }, include: SHIPPING_RULE_INCLUDE });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "ShippingRule", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Deletes a shipping rule, moving any products using it to a replacement.
 *
 * Same reasoning as tax rules: a product must be deliverable, so it cannot
 * simply lose its rule. The move happens in the same transaction as the delete.
 */
const deleteShippingRule = async (userId: string, id: string, reassignToId?: string) => {
    const existing = await prisma.shippingRule.findUnique({
        where: { id },
        include: SHIPPING_RULE_INCLUDE,
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Shipping rule not found");
    }

    const inUse = await prisma.product.count({ where: { shippingRuleId: id } });

    if (inUse > 0) {
        if (!reassignToId) {
            throw new AppError(
                status.CONFLICT,
                `${inUse} product${inUse === 1 ? " uses" : "s use"} this shipping rule. Choose another rule to move ${inUse === 1 ? "it" : "them"} to.`,
            );
        }

        if (reassignToId === id) {
            throw new AppError(
                status.BAD_REQUEST,
                "Cannot reassign products to the rule being deleted",
            );
        }

        const replacement = await prisma.shippingRule.findUnique({
            where: { id: reassignToId },
            select: { id: true },
        });

        if (!replacement) {
            throw new AppError(status.BAD_REQUEST, "The replacement shipping rule does not exist");
        }
    }

    await prisma.$transaction(async (tx) => {
        if (inUse > 0) {
            await tx.product.updateMany({
                where: { shippingRuleId: id },
                data: { shippingRuleId: reassignToId },
            });
        }
        await tx.shippingRule.delete({ where: { id } });
    });

    await AuditLogService.record(userId, AuditAction.DELETE, "ShippingRule", id, {
        oldData: existing,
    });

    return { shippingRule: existing, reassignedProducts: inUse };
};

const getShippingRules = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.shippingRule, queryParams, {
        searchableFields: ["name"],
        filterableFields: [],
    });

    return queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        .include(SHIPPING_RULE_INCLUDE)
        .execute();
};

const getShippingRuleById = async (id: string) => {
    const rule = await prisma.shippingRule.findUnique({
        where: { id },
        include: SHIPPING_RULE_INCLUDE,
    });

    if (!rule) {
        throw new AppError(status.NOT_FOUND, "Shipping rule not found");
    }

    return rule;
};

/** Every rule, for the product form's picker. Unpaginated. */
const getAllShippingRules = async () =>
    prisma.shippingRule.findMany({ orderBy: { name: "asc" }, include: SHIPPING_RULE_INCLUDE });

/**
 * The place in a rule that covers `destination`, most specific first.
 *
 * Region beats country beats catch-all. Returns null when nothing matches — the
 * caller must then tell the shopper the product cannot be delivered there,
 * rather than charging an arbitrary amount or nothing at all.
 */
const matchPlace = async (
    shippingRuleId: string,
    destination: { country?: string; state?: string },
) => {
    const places = await prisma.shippingPlace.findMany({ where: { shippingRuleId } });

    const { country, state } = destination;

    return (
        places.find((p) => country && state && p.country === country && p.state === state) ??
        places.find((p) => country && p.country === country && p.state === null) ??
        places.find((p) => p.country === null && p.state === null) ??
        null
    );
};

export const ShippingRuleService = {
    createShippingRule,
    updateShippingRule,
    deleteShippingRule,
    getShippingRules,
    getShippingRuleById,
    getAllShippingRules,
    matchPlace,
};
