import status from "http-status";
import { AuditAction } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { BANNERS_TAG, STORE_SETTINGS_TAG, revalidateStorefront } from "../../utils/revalidateStorefront";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    ICreatePromoBannerGroupPayload,
    IReorderPromoBannerGroupsPayload,
    IUpdatePromoBannerGroupPayload,
} from "./promo-banner-group.interface";

/**
 * Promotional banner strips — merchant-created, named, each with its own tile
 * count and its own artwork.
 *
 * ── Why EVERY mutation fires TWO cache tags ──────────────────────────────
 *
 * `banners` because the strip's contents changed, and `store-settings` because
 * a group's EXISTENCE, NAME, LAYOUT AND ORDER are served in the settings
 * payload and consumed by homeConfig reconciliation. Firing only `banners`
 * would leave a renamed or newly-created group invisible for a full settings
 * window — precisely the failure add-storefront-cache-tags was written to fix,
 * where a merchant's save was silently deferred for five minutes.
 *
 * Both fire AFTER the write resolves, never inside a transaction: firing within
 * means a rollback still invalidates, and the storefront can re-fetch and
 * re-cache the pre-commit state before the commit lands.
 *
 * See openspec/changes/add-promo-banner-groups, design.md Decision 8.
 */

/** The merchant's own order, then newest first among equals — matching Banner
 *  and Testimonial, so every content manager behaves the same way when a
 *  merchant leaves every `sortOrder` at 0. */
const DISPLAY_ORDER = [{ sortOrder: "asc" as const }, { createdAt: "desc" as const }];

/** Both tags, together, on every mutation. A single helper rather than two
 *  calls at eight sites — one of which would eventually be written with one
 *  tag and not the other. */
const revalidatePromoGroups = () => {
    revalidateStorefront(BANNERS_TAG);
    revalidateStorefront(STORE_SETTINGS_TAG);
};

const getPromoBannerGroupOrThrow = async (id: string) => {
    const group = await prisma.promoBannerGroup.findUnique({ where: { id } });

    if (!group) {
        throw new AppError(status.NOT_FOUND, "Promo banner group not found");
    }

    return group;
};

/**
 * Every group with its banner count.
 *
 * `_count` rather than loading the banners: every surface that lists groups
 * needs the number and none of them needs the rows, so fetching the artwork to
 * call `.length` on it would be the whole strip's payload wasted per group.
 */
const listPromoBannerGroups = async () => {
    const groups = await prisma.promoBannerGroup.findMany({
        orderBy: DISPLAY_ORDER,
        include: { _count: { select: { banners: true } } },
    });

    return groups.map(({ _count, ...group }) => ({ ...group, bannerCount: _count.banners }));
};

const getPromoBannerGroupById = async (id: string) => {
    const group = await prisma.promoBannerGroup.findUnique({
        where: { id },
        include: { _count: { select: { banners: true } } },
    });

    if (!group) {
        throw new AppError(status.NOT_FOUND, "Promo banner group not found");
    }

    const { _count, ...rest } = group;

    return { ...rest, bannerCount: _count.banners };
};

/**
 * A new group lands at the END of the existing ones unless the caller says
 * otherwise.
 *
 * Appending rather than defaulting `sortOrder` to 0: with the column default,
 * every group a merchant created without touching the order would tie at 0 and
 * the tie would break on `createdAt desc` — so each new strip would appear
 * ABOVE the ones before it, which is the opposite of what adding something to a
 * list looks like anywhere else in the admin.
 */
const createPromoBannerGroup = async (
    userId: string | undefined,
    payload: ICreatePromoBannerGroupPayload,
) => {
    const sortOrder =
        payload.sortOrder ??
        ((await prisma.promoBannerGroup.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ??
            -1) + 1;

    const group = await prisma.promoBannerGroup.create({
        data: { ...payload, sortOrder },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "PromoBannerGroup", group.id, {
        newData: group,
    });

    revalidatePromoGroups();

    return group;
};

const updatePromoBannerGroup = async (
    userId: string | undefined,
    id: string,
    payload: IUpdatePromoBannerGroupPayload,
) => {
    const existing = await getPromoBannerGroupOrThrow(id);

    const group = await prisma.promoBannerGroup.update({ where: { id }, data: payload });

    await AuditLogService.record(userId, AuditAction.UPDATE, "PromoBannerGroup", id, {
        oldData: existing,
        newData: group,
    });

    revalidatePromoGroups();

    return group;
};

/**
 * Writes the whole order in one transaction.
 *
 * ALL OR NOTHING, deliberately: a partially-applied reorder leaves two groups
 * sharing a position and the merchant looking at a list that matches neither
 * what they had nor what they asked for. `sortOrder` is the array index, so the
 * client sends intent and the server owns the numbering.
 *
 * Every id is verified to exist FIRST. Without that, an id from a group deleted
 * in another tab would fail mid-transaction and roll back the whole reorder
 * with a raw Prisma error rather than a stated one.
 */
const reorderPromoBannerGroups = async (
    userId: string | undefined,
    payload: IReorderPromoBannerGroupsPayload,
) => {
    const { ids } = payload;

    const unique = new Set(ids);

    if (unique.size !== ids.length) {
        throw new AppError(status.BAD_REQUEST, "Duplicate group ids in reorder request");
    }

    const existing = await prisma.promoBannerGroup.findMany({
        where: { id: { in: ids } },
        select: { id: true },
    });

    if (existing.length !== ids.length) {
        throw new AppError(
            status.BAD_REQUEST,
            "One or more promo banner groups in the reorder request no longer exist",
        );
    }

    await prisma.$transaction(
        ids.map((id, index) =>
            prisma.promoBannerGroup.update({ where: { id }, data: { sortOrder: index } }),
        ),
    );

    await AuditLogService.record(userId, AuditAction.UPDATE, "PromoBannerGroup", ids[0] as string, {
        newData: { reorderedIds: ids },
    });

    revalidatePromoGroups();

    return listPromoBannerGroups();
};

/**
 * Deletes the group and DETACHES its banners — it does not delete them.
 *
 * Nothing here touches Banner: `Banner.promoBannerGroupId` is declared
 * `onDelete: SetNull`, so the database performs the detach. A merchant who
 * deletes a strip is removing an arrangement, not discarding artwork they paid
 * for; the banners stay on file and appear in the admin's banner list as
 * unassigned.
 *
 * The homepage section entry naming this group is not deleted here either —
 * `reconcileHomeConfig` drops an entry whose group no longer exists, on read.
 * Writing to StoreSetting from here would be a second, divergent copy of that
 * rule, and would have to run for every store rather than the one being read.
 */
const deletePromoBannerGroup = async (userId: string | undefined, id: string) => {
    const existing = await getPromoBannerGroupOrThrow(id);

    const group = await prisma.promoBannerGroup.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "PromoBannerGroup", id, {
        oldData: existing,
    });

    revalidatePromoGroups();

    return group;
};

export const PromoBannerGroupService = {
    getPromoBannerGroupOrThrow,
    listPromoBannerGroups,
    getPromoBannerGroupById,
    createPromoBannerGroup,
    updatePromoBannerGroup,
    reorderPromoBannerGroups,
    deletePromoBannerGroup,
};
