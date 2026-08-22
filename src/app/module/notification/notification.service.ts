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

export const NotificationService = {
    createNotification,
    notifyOwnersAndAdmins,
    getMyNotifications,
    markAsRead,
    markAllAsRead,
};
