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

/** Read-only — audit logs are an immutable trail written by other endpoints, never user-authored content; there is deliberately no create/update/delete here. */
const getAuditLogs = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.auditLog, queryParams, {
        filterableFields: ["entity", "entityId", "action", "userId"],
    });

    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .include({ user: { select: { id: true, name: true, email: true } } })
        .execute();
};

export const AuditLogService = {
    record,
    getAuditLogs,
};
