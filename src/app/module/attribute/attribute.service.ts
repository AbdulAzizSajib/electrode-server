import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    IAttributeValueInput,
    ICreateAttributePayload,
    IUpdateAttributePayload,
} from "./attribute.interface";

/** Values in the merchant's authored order — never alphabetical. */
const ATTRIBUTE_INCLUDE = {
    values: { orderBy: { position: "asc" as const } },
} as const;

/**
 * Rejects two values that would read as the same choice.
 *
 * The database enforces this with a unique constraint, but a constraint
 * violation surfaces as a 500 from inside a transaction. Catching it here makes
 * it a 400 naming the offender, and runs before any write.
 */
const ensureValuesAreDistinct = (values: IAttributeValueInput[]) => {
    const labels = values.map((v) => v.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) {
        throw new AppError(status.BAD_REQUEST, "Duplicate values in this attribute");
    }
};

/**
 * Rejects a name another attribute already uses, compared case-insensitively.
 *
 * The unique index is exact, so "Colour" and "colour" would both be allowed by
 * the database — and a merchant would then see two attributes that look
 * identical, which is precisely the confusion moving attributes shop-wide
 * exists to end.
 */
const ensureNameIsFree = async (name: string, excludeId?: string) => {
    const clash = await prisma.attribute.findFirst({
        where: {
            name: { equals: name.trim(), mode: "insensitive" },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, name: true },
    });

    if (clash) {
        throw new AppError(status.CONFLICT, `An attribute named "${clash.name}" already exists`);
    }
};

const createAttribute = async (userId: string, payload: ICreateAttributePayload) => {
    await ensureNameIsFree(payload.name);
    ensureValuesAreDistinct(payload.values);

    const attribute = await prisma.attribute.create({
        data: {
            name: payload.name.trim(),
            ...(payload.presentation ? { presentation: payload.presentation } : {}),
            values: {
                create: payload.values.map((value, position) => ({
                    label: value.label.trim(),
                    position,
                    swatch: value.swatch ?? null,
                })),
            },
        },
        include: ATTRIBUTE_INCLUDE,
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "Attribute", attribute.id, {
        newData: attribute,
    });

    return attribute;
};

/**
 * How many products sell a given set of attribute values.
 *
 * Counted through variants: a product "sells" a value when one of its variants
 * is defined by it. This is what the delete guards report, so a merchant is
 * told the scale of what they are about to break rather than discovering it
 * afterwards.
 */
const countProductsUsingValues = async (valueIds: string[]) => {
    if (valueIds.length === 0) return 0;

    const rows = await prisma.productVariantOptionValue.findMany({
        where: { valueId: { in: valueIds } },
        select: { variant: { select: { productId: true } } },
    });

    return new Set(rows.map((r) => r.variant.productId)).size;
};

/**
 * Reconciles an attribute's values: those with an `id` are updated, those
 * without are created, and existing values absent from the payload are deleted.
 *
 * Deleting a value that products sell would cascade to their variants'
 * selections, leaving those variants unresolvable — which reads to a shopper as
 * "Sold out" on a product that has stock. So a value in use is refused unless
 * the caller explicitly confirms, and the refusal says how many products are
 * affected.
 */
const syncAttributeValues = async (
    tx: Prisma.TransactionClient,
    attributeId: string,
    values: IAttributeValueInput[],
) => {
    const existing = await tx.attributeValue.findMany({
        where: { attributeId },
        select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const keepIds = new Set(values.filter((v) => v.id).map((v) => v.id as string));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
        await tx.attributeValue.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const [position, value] of values.entries()) {
        const data = {
            label: value.label.trim(),
            position,
            swatch: value.swatch ?? null,
        };

        if (value.id) {
            if (!existingIds.has(value.id)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Value ${value.id} does not belong to this attribute`,
                );
            }
            await tx.attributeValue.update({ where: { id: value.id }, data });
        } else {
            await tx.attributeValue.create({ data: { ...data, attributeId } });
        }
    }
};

const updateAttribute = async (
    userId: string,
    id: string,
    payload: IUpdateAttributePayload,
    options: { force?: boolean } = {},
) => {
    const existing = await prisma.attribute.findUnique({
        where: { id },
        include: ATTRIBUTE_INCLUDE,
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Attribute not found");
    }

    if (payload.name) {
        await ensureNameIsFree(payload.name, id);
    }

    if (payload.values) {
        ensureValuesAreDistinct(payload.values);

        // Checked before the transaction opens, so a refused request modifies
        // nothing.
        const keepIds = new Set(payload.values.filter((v) => v.id).map((v) => v.id as string));
        const removedIds = existing.values.filter((v) => !keepIds.has(v.id)).map((v) => v.id);
        const affected = await countProductsUsingValues(removedIds);

        if (affected > 0 && !options.force) {
            throw new AppError(
                status.CONFLICT,
                `${affected} product${affected === 1 ? " still sells" : "s still sell"} values you are removing. Confirm to remove them anyway.`,
            );
        }
    }

    const updated = await prisma.$transaction(async (tx) => {
        await tx.attribute.update({
            where: { id },
            data: {
                ...(payload.name ? { name: payload.name.trim() } : {}),
                ...(payload.presentation ? { presentation: payload.presentation } : {}),
            },
        });

        if (payload.values) {
            await syncAttributeValues(tx, id, payload.values);
        }

        return tx.attribute.findUniqueOrThrow({ where: { id }, include: ATTRIBUTE_INCLUDE });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Attribute", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Deletes an attribute, refusing while products still sell its values unless
 * the caller confirms.
 *
 * Cascade would take every variant's selection with it, so this is the one
 * guard standing between a routine catalog edit and a shop full of unbuyable
 * products.
 */
const deleteAttribute = async (userId: string, id: string, options: { force?: boolean } = {}) => {
    const existing = await prisma.attribute.findUnique({
        where: { id },
        include: ATTRIBUTE_INCLUDE,
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Attribute not found");
    }

    const affected = await countProductsUsingValues(existing.values.map((v) => v.id));

    if (affected > 0 && !options.force) {
        throw new AppError(
            status.CONFLICT,
            `${affected} product${affected === 1 ? " still sells" : "s still sell"} this attribute. Confirm to delete it and remove those choices.`,
        );
    }

    await prisma.attribute.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Attribute", id, {
        oldData: existing,
    });

    return { attribute: existing, affectedProducts: affected };
};

const getAttributes = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.attribute, queryParams, {
        searchableFields: ["name"],
        filterableFields: ["presentation"],
    });

    return queryBuilder.search().filter().sort().paginate().include(ATTRIBUTE_INCLUDE).execute();
};

const getAttributeById = async (id: string) => {
    const attribute = await prisma.attribute.findUnique({
        where: { id },
        include: ATTRIBUTE_INCLUDE,
    });

    if (!attribute) {
        throw new AppError(status.NOT_FOUND, "Attribute not found");
    }

    return attribute;
};

/** Every attribute with its values, for the admin's product form. Unpaginated. */
const getAllAttributes = async () =>
    prisma.attribute.findMany({
        orderBy: [{ position: "asc" }, { name: "asc" }],
        include: ATTRIBUTE_INCLUDE,
    });

export const AttributeService = {
    createAttribute,
    updateAttribute,
    deleteAttribute,
    getAttributes,
    getAttributeById,
    getAllAttributes,
};
