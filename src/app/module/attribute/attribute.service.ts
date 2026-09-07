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
    ICreateAttributeValuePayload,
    IUpdateAttributePayload,
    IUpdateAttributeValuePayload,
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

/**
 * Loads a value, refusing one that belongs to a different attribute.
 *
 * The id alone would be enough to find the row, but taking the attribute from
 * the path and checking it means a mistyped url edits nothing rather than
 * silently renaming a colour on some other attribute.
 */
const findValueOrThrow = async (attributeId: string, valueId: string) => {
    const value = await prisma.attributeValue.findUnique({ where: { id: valueId } });

    if (!value || value.attributeId !== attributeId) {
        throw new AppError(status.NOT_FOUND, "Value not found on this attribute");
    }

    return value;
};

/** Rejects a label a sibling value already uses, compared case-insensitively. */
const ensureLabelIsFree = async (attributeId: string, label: string, excludeId?: string) => {
    const clash = await prisma.attributeValue.findFirst({
        where: {
            attributeId,
            label: { equals: label.trim(), mode: "insensitive" },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { label: true },
    });

    if (clash) {
        throw new AppError(status.CONFLICT, `This attribute already has "${clash.label}"`);
    }
};

/**
 * Adds one value to an existing attribute, leaving its siblings alone.
 *
 * This exists so the product form can offer "add a colour" without holding the
 * whole attribute: `updateAttribute` treats its `values` array as the complete
 * set and deletes whatever is missing from it, which makes a partial payload —
 * or a payload built from a list fetched a minute ago — quietly destructive.
 */
const createAttributeValue = async (
    userId: string,
    attributeId: string,
    payload: ICreateAttributeValuePayload,
) => {
    const attribute = await prisma.attribute.findUnique({ where: { id: attributeId } });

    if (!attribute) {
        throw new AppError(status.NOT_FOUND, "Attribute not found");
    }

    await ensureLabelIsFree(attributeId, payload.label);

    // Appended, not inserted: the merchant's authored order is meaningful
    // (S -> M -> XL), and the Attributes page is where it gets rearranged.
    const last = await prisma.attributeValue.findFirst({
        where: { attributeId },
        orderBy: { position: "desc" },
        select: { position: true },
    });

    const value = await prisma.attributeValue.create({
        data: {
            attributeId,
            label: payload.label.trim(),
            position: (last?.position ?? -1) + 1,
            swatch: payload.swatch ?? null,
        },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "AttributeValue", value.id, {
        newData: value,
    });

    return value;
};

/**
 * Renames or recolours one value in place.
 *
 * Editing rather than replacing is what keeps every product already selling it
 * selling it still: the row keeps its id, so no variant loses its selection.
 * That also means the rename is shop-wide, which is the merchant's to weigh —
 * the admin says so before it is sent.
 */
const updateAttributeValue = async (
    userId: string,
    attributeId: string,
    valueId: string,
    payload: IUpdateAttributeValuePayload,
) => {
    const existing = await findValueOrThrow(attributeId, valueId);

    if (payload.label !== undefined) {
        await ensureLabelIsFree(attributeId, payload.label, valueId);
    }

    const value = await prisma.attributeValue.update({
        where: { id: valueId },
        data: {
            ...(payload.label !== undefined ? { label: payload.label.trim() } : {}),
            ...(payload.swatch !== undefined ? { swatch: payload.swatch } : {}),
        },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "AttributeValue", valueId, {
        oldData: existing,
        newData: value,
    });

    return value;
};

/**
 * Deletes one value, refusing while products still sell it unless confirmed.
 *
 * Same guard, and for the same reason, as removing one through
 * `updateAttribute`: the delete cascades to every variant defined by this
 * value, and a variant with no selections reads to a shopper as "Sold out" on a
 * product that has stock. The refusal names the count so the admin can ask.
 */
const deleteAttributeValue = async (
    userId: string,
    attributeId: string,
    valueId: string,
    options: { force?: boolean } = {},
) => {
    const existing = await findValueOrThrow(attributeId, valueId);

    // An attribute with no values leaves a checkbox group with nothing to tick
    // — the dead end `createAttribute`'s min-1 rule exists to prevent. Deleting
    // the attribute itself is the Attributes page's job, and says so.
    const siblings = await prisma.attributeValue.count({ where: { attributeId } });

    if (siblings <= 1) {
        throw new AppError(
            status.CONFLICT,
            "An attribute needs at least one value. Delete the attribute instead.",
        );
    }

    const affected = await countProductsUsingValues([valueId]);

    if (affected > 0 && !options.force) {
        throw new AppError(
            status.CONFLICT,
            `${affected} product${affected === 1 ? " still sells" : "s still sell"} "${existing.label}". Confirm to remove it anyway.`,
        );
    }

    await prisma.attributeValue.delete({ where: { id: valueId } });

    await AuditLogService.record(userId, AuditAction.DELETE, "AttributeValue", valueId, {
        oldData: existing,
    });

    return { value: existing, affectedProducts: affected };
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
    createAttributeValue,
    updateAttributeValue,
    deleteAttributeValue,
};
