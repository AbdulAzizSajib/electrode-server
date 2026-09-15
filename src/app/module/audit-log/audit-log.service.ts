import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";

/**
 * Shared write path for every admin-mutating action across the platform
 * (catalog, inventory, marketing, checkout, post-purchase, RBAC, settings —
 * see design.md's "Concrete AuditLog trigger list") — per `api/support-and-admin`
 * spec's extended "Audit logs are read-only and admin-scoped" requirement.
 *
 * Called as an immediate follow-up right after the triggering mutation
 * succeeds, not inside its transaction — a failure here is logged and
 * swallowed rather than allowed to fail (or roll back) the action that
 * triggered it, same posture as `NotificationService`'s writes.
 */
const record = async (
    userId: string | undefined,
    action: AuditAction,
    entity: string,
    entityId?: string,
    data?: { oldData?: unknown; newData?: unknown },
) => {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action,
                entity,
                entityId,
                oldData: data?.oldData as Prisma.InputJsonValue | undefined,
                newData: data?.newData as Prisma.InputJsonValue | undefined,
            },
        });
    } catch (error) {
        console.error(`Failed to write audit log entry (${action} ${entity} ${entityId ?? ""}):`, error);
    }
};

/** Written by other endpoints, never user-authored content — `record` above is the only create path. */
const getAuditLogs = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.auditLog, queryParams, {
        // `createdAt` is here so the admin's date-range filter actually applies: QueryBuilder
        // silently DROPS any param outside this list, so without it a `createdAt[gte]=...` query
        // returned the full, unfiltered trail while looking like it had filtered — a wrong answer
        // rather than an error. Range syntax (`createdAt[gte]`/`[lte]`) is parsed by
        // QueryBuilder.parseRangeFilter, which passes ISO date strings through for Prisma to coerce.
        filterableFields: ["entity", "entityId", "action", "userId", "createdAt"],
    });

    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .include({ user: { select: { id: true, name: true, email: true } } })
        .execute();
};

/**
 * Removes audit entries by id, and records having done so.
 *
 * ## Read this before extending it
 *
 * The trail was append-only by spec, and that requirement was dropped
 * deliberately (see `api/support-and-admin`, "Audit logs are admin-scoped and
 * prunable") so a merchant could keep the table from growing without bound.
 * The cost is real and worth stating plainly: an actor who can delete audit
 * entries can delete the evidence of what they did. That is the whole reason
 * the original requirement existed.
 *
 * Three things hold the remaining line, and none of them are decoration:
 *
 * 1. **OWNER only.** ADMIN can read the trail but not prune it. Enforced on the
 *    route — a STAFF or ADMIN token gets 403 before reaching this function.
 * 2. **The purge is itself audited.** A `DELETE` entry naming the purged ids is
 *    written after the fact, so "rows vanished" is always distinguishable from
 *    "rows were never written". Deleting that record needs a second purge,
 *    which writes another one; there is no fixed point where the trail goes
 *    quiet on its own.
 * 3. **Explicit ids only.** No date-range or filter purge, so there is no
 *    single call that empties the table.
 *
 * If you are adding a filtered or scheduled purge later, keep (2): a purge that
 * does not record itself turns every future gap in the trail into an
 * unanswerable question.
 */
const deleteAuditLogs = async (userId: string, ids: string[]) => {
    const { count } = await prisma.auditLog.deleteMany({ where: { id: { in: ids } } });

    /*
     * After the delete, not inside a transaction with it — same posture as
     * `record` above. If this write fails the purge still stands; the entry is
     * a record of what happened, not a precondition for it.
     *
     * `newData` carries the ids rather than the deleted rows themselves:
     * copying the rows would make the purge a no-op that doubles storage, which
     * defeats the point of pruning.
     */
    await record(userId, AuditAction.DELETE, "AuditLog", undefined, {
        newData: { purgedIds: ids, deleted: count },
    });

    return { deleted: count };
};

export const AuditLogService = {
    record,
    getAuditLogs,
    deleteAuditLogs,
};
