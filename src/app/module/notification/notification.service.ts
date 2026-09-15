import status from "http-status";
import { RoleId } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { NotificationPriority, NotificationType, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";

interface INotificationOptions {
    link?: string;
    priority?: NotificationPriority;
    metadata?: Prisma.InputJsonValue;
}

/**
 * Shared write path for every lifecycle-event notification across the
 * platform (order/payment/return/refund/review/support — see design.md's
 * "Concrete Notification trigger list") — per `api/support-and-admin` spec's
 * "Key lifecycle events create Notifications for the affected user".
 *
 * Called as an immediate follow-up right after the triggering mutation
 * succeeds (or inside its transaction where one is already open) — a
 * failure here is logged and swallowed rather than allowed to fail the
 * action that triggered it, same posture as `AuditLogService.record`.
 */
const createNotification = async (
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    options?: INotificationOptions,
) => {
    try {
        await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                link: options?.link,
                priority: options?.priority,
                metadata: options?.metadata,
            },
        });
    } catch (error) {
        console.error(`Failed to create notification (${type} for user ${userId}):`, error);
    }
};

/** Used for platform-wide alerts (e.g. low stock) rather than a single affected user. */
const notifyOwnersAndAdmins = async (
    type: NotificationType,
    title: string,
    message: string,
    options?: INotificationOptions,
) => {
    try {
        const recipients = await prisma.user.findMany({
            where: { roleId: { in: [RoleId.OWNER, RoleId.ADMIN] }, isActive: true, isDeleted: false },
            select: { id: true },
        });

        if (recipients.length === 0) return;

        await prisma.notification.createMany({
            data: recipients.map((recipient) => ({
                userId: recipient.id,
                type,
                title,
                message,
                link: options?.link,
                priority: options?.priority,
                metadata: options?.metadata,
            })),
        });
    } catch (error) {
        console.error(`Failed to notify OWNER/ADMIN (${type}):`, error);
    }
};

const getMyNotifications = async (userId: string, queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.notification, queryParams, {
        filterableFields: ["isRead", "type", "priority"],
    });

    return queryBuilder.filter().sort().paginate().where({ userId }).execute();
};

const markAsRead = async (userId: string, notificationId: string) => {
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });

    if (!notification || notification.userId !== userId) {
        throw new AppError(status.NOT_FOUND, "Notification not found");
    }

    if (notification.isRead) {
        return notification;
    }

    return prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true, readAt: new Date() },
    });
};

const markAllAsRead = async (userId: string) => {
    await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
    });

    return { success: true };
};

/**
 * Removes a caller's own notifications by id.
 *
 * `userId` is part of the WHERE clause rather than checked beforehand: a
 * `findMany`-then-`deleteMany` would be a TOCTOU gap, and more importantly a
 * separate check invites a future edit that drops it. Scoping the delete itself
 * means an id belonging to another user matches nothing — there is no code path
 * here that can reach another user's rows, which is what
 * `api/support-and-admin`'s per-user notification rule requires.
 *
 * The count is returned so the caller can tell a partial hit from a complete
 * one. Deleting an id that is already gone is deliberately NOT an error: two
 * admins clearing the same list, or a double-submitted request, should both
 * settle rather than surface a failure for work that is already done.
 */
const deleteNotifications = async (userId: string, ids: string[]) => {
    const { count } = await prisma.notification.deleteMany({
        where: { id: { in: ids }, userId },
    });

    return { deleted: count };
};

/**
 * Clears every notification the caller has already read.
 *
 * Unread ones are deliberately left behind: they are the ones the user has not
 * seen yet, so a "clear" that silently discarded them would lose the only
 * signal the feature exists to deliver.
 */
const deleteAllRead = async (userId: string) => {
    const { count } = await prisma.notification.deleteMany({
        where: { userId, isRead: true },
    });

    return { deleted: count };
};

export const NotificationService = {
    createNotification,
    notifyOwnersAndAdmins,
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotifications,
    deleteAllRead,
};
