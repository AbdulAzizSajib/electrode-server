import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ICreateTaxRulePayload, IUpdateTaxRulePayload } from "./tax-rule.interface";

/**
 * Rejects a name another rule already uses, compared case-insensitively — the
 * unique index is exact, so "VAT" and "vat" would otherwise both be allowed and
 * a merchant would face two rules that look identical.
 */
const ensureNameIsFree = async (name: string, excludeId?: string) => {
    const clash = await prisma.taxRule.findFirst({
        where: {
            name: { equals: name.trim(), mode: "insensitive" },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { name: true },
    });

    if (clash) {
        throw new AppError(status.CONFLICT, `A tax rule named "${clash.name}" already exists`);
    }
};

const createTaxRule = async (userId: string, payload: ICreateTaxRulePayload) => {
    await ensureNameIsFree(payload.name);

    const taxRule = await prisma.taxRule.create({
        data: { ...payload, name: payload.name.trim() },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "TaxRule", taxRule.id, {
        newData: taxRule,
    });

    return taxRule;
};

const updateTaxRule = async (userId: string, id: string, payload: IUpdateTaxRulePayload) => {
    const existing = await prisma.taxRule.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Tax rule not found");
    }

    if (payload.name) {
        await ensureNameIsFree(payload.name, id);
    }

    const updated = await prisma.taxRule.update({
        where: { id },
        data: { ...payload, ...(payload.name ? { name: payload.name.trim() } : {}) },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "TaxRule", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Deletes a tax rule, moving any products using it to a replacement.
 *
 * A product must be taxable, so it cannot simply lose its rule — the foreign
 * key is Restrict for exactly that reason. The caller names the replacement,
 * and the move happens in the same transaction as the delete so no product is
 * ever briefly without one.
 */
const deleteTaxRule = async (userId: string, id: string, reassignToId?: string) => {
    const existing = await prisma.taxRule.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Tax rule not found");
    }

    const inUse = await prisma.product.count({ where: { taxRuleId: id } });

    if (inUse > 0) {
        if (!reassignToId) {
            throw new AppError(
                status.CONFLICT,
                `${inUse} product${inUse === 1 ? " uses" : "s use"} this tax rule. Choose another rule to move ${inUse === 1 ? "it" : "them"} to.`,
            );
        }

        if (reassignToId === id) {
            throw new AppError(status.BAD_REQUEST, "Cannot reassign products to the rule being deleted");
        }

        const replacement = await prisma.taxRule.findUnique({
            where: { id: reassignToId },
            select: { id: true },
        });

        if (!replacement) {
            throw new AppError(status.BAD_REQUEST, "The replacement tax rule does not exist");
        }
    }

    await prisma.$transaction(async (tx) => {
        if (inUse > 0) {
            await tx.product.updateMany({
                where: { taxRuleId: id },
                data: { taxRuleId: reassignToId },
            });
        }
        await tx.taxRule.delete({ where: { id } });
    });

    await AuditLogService.record(userId, AuditAction.DELETE, "TaxRule", id, { oldData: existing });

    return { taxRule: existing, reassignedProducts: inUse };
};

const getTaxRules = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.taxRule, queryParams, {
        searchableFields: ["name"],
        filterableFields: ["type"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getTaxRuleById = async (id: string) => {
    const taxRule = await prisma.taxRule.findUnique({ where: { id } });

    if (!taxRule) {
        throw new AppError(status.NOT_FOUND, "Tax rule not found");
    }

    return taxRule;
};

/** Every rule, for the product form's picker. Unpaginated. */
const getAllTaxRules = async () => prisma.taxRule.findMany({ orderBy: { name: "asc" } });

export const TaxRuleService = {
    createTaxRule,
    updateTaxRule,
    deleteTaxRule,
    getTaxRules,
    getTaxRuleById,
    getAllTaxRules,
};
