/**
 * Verification for bulk deletion of notifications and audit-log entries.
 *
 * The properties under test are the ones whose failure is silent and costly:
 *
 *  - a user's delete CANNOT reach another user's notifications, no matter what
 *    ids are submitted (the per-user rule in `api/support-and-admin`);
 *  - clearing read notifications leaves unread ones alone, because those are
 *    the only ones carrying information the user has not seen;
 *  - deleting an already-deleted id settles rather than erroring, so a
 *    double-submit or two admins clearing the same list both succeed;
 *  - an audit purge writes its own `DELETE` entry, which is the single thing
 *    keeping a pruned trail distinguishable from one that was never written.
 *
 * Imports the services directly — no HTTP — per the repo's testing approach.
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-notification-audit-delete.ts
 */
import { AuditAction, NotificationType } from "../src/generated/prisma/client";
import { RoleId } from "../src/app/constants/role.constant";
import { prisma } from "../src/app/lib/prisma";
import { AuditLogService } from "../src/app/module/audit-log/audit-log.service";
import { NotificationService } from "../src/app/module/notification/notification.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const PREFIX = "__verify_notif_del";

const main = async () => {
    /*
     * Two users, because the property that matters most is that one cannot
     * delete the other's rows. A single-user test would pass even if the
     * `userId` scope were dropped entirely.
     */
    // `User.id` has no database default — better-auth supplies it in the real
    // flow, so a script creating users has to mint its own.
    const [owner, other] = await Promise.all([
        prisma.user.create({
            data: {
                id: `${PREFIX}_owner_id`,
                name: `${PREFIX}_owner`,
                email: `${PREFIX}_owner@example.test`,
                roleId: RoleId.OWNER,
            },
            select: { id: true },
        }),
        prisma.user.create({
            data: {
                id: `${PREFIX}_other_id`,
                name: `${PREFIX}_other`,
                email: `${PREFIX}_other@example.test`,
                roleId: RoleId.CUSTOMER,
            },
            select: { id: true },
        }),
    ]);

    try {
        const makeNotif = (userId: string, title: string, isRead: boolean) =>
            prisma.notification.create({
                data: {
                    userId,
                    type: NotificationType.SYSTEM,
                    title: `${PREFIX}_${title}`,
                    message: "verification row",
                    isRead,
                    readAt: isRead ? new Date() : null,
                },
                select: { id: true },
            });

        // --- a delete cannot cross users ----------------------------------
        const victim = await makeNotif(other.id, "victim", false);
        const mine = await makeNotif(owner.id, "mine", false);

        const crossed = await NotificationService.deleteNotifications(owner.id, [
            mine.id,
            victim.id,
        ]);
        const victimSurvives = await prisma.notification.findUnique({ where: { id: victim.id } });

        check(
            "cross-user delete",
            crossed.deleted === 1 && victimSurvives !== null,
            `deleted ${crossed.deleted} (expected 1); other user's row ${victimSurvives ? "survived" : "WAS REMOVED"}`,
        );

        // --- deleting a gone id is not an error ---------------------------
        const repeat = await NotificationService.deleteNotifications(owner.id, [mine.id]);
        check(
            "repeat delete settles",
            repeat.deleted === 0,
            `re-deleting an already-removed id reported ${repeat.deleted}, no throw`,
        );

        // --- clearing read leaves unread alone ----------------------------
        const read1 = await makeNotif(owner.id, "read1", true);
        const read2 = await makeNotif(owner.id, "read2", true);
        const unread = await makeNotif(owner.id, "unread", false);
        void read1;
        void read2;

        const cleared = await NotificationService.deleteAllRead(owner.id);
        const unreadSurvives = await prisma.notification.findUnique({ where: { id: unread.id } });

        check(
            "clear-read spares unread",
            cleared.deleted === 2 && unreadSurvives !== null,
            `cleared ${cleared.deleted} read (expected 2); unread ${unreadSurvives ? "survived" : "WAS REMOVED"}`,
        );

        // --- clear-read does not cross users ------------------------------
        const otherRead = await makeNotif(other.id, "other_read", true);
        await NotificationService.deleteAllRead(owner.id);
        const otherReadSurvives = await prisma.notification.findUnique({
            where: { id: otherRead.id },
        });
        check(
            "clear-read is per-user",
            otherReadSurvives !== null,
            `other user's read row ${otherReadSurvives ? "survived" : "WAS REMOVED"}`,
        );

        // --- an audit purge records itself --------------------------------
        const doomed = await prisma.auditLog.create({
            data: { userId: owner.id, action: AuditAction.UPDATE, entity: `${PREFIX}_entity` },
            select: { id: true },
        });

        const purged = await AuditLogService.deleteAuditLogs(owner.id, [doomed.id]);
        const gone = await prisma.auditLog.findUnique({ where: { id: doomed.id } });
        const receipt = await prisma.auditLog.findFirst({
            where: { userId: owner.id, entity: "AuditLog", action: AuditAction.DELETE },
            orderBy: { createdAt: "desc" },
        });
        const receiptNamesIt =
            receipt !== null &&
            JSON.stringify((receipt.newData as { purgedIds?: string[] })?.purgedIds ?? []).includes(
                doomed.id,
            );

        check(
            "audit purge removes the row",
            purged.deleted === 1 && gone === null,
            `deleted ${purged.deleted}; row ${gone === null ? "gone" : "STILL PRESENT"}`,
        );
        check(
            "audit purge writes its own receipt",
            receiptNamesIt,
            receipt
                ? `receipt ${receipt.id} ${receiptNamesIt ? "names" : "DOES NOT NAME"} the purged id`
                : "NO receipt entry was written",
        );
    } finally {
        // Order matters: notifications and audit rows reference the users.
        await prisma.notification.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
        await prisma.auditLog.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
        await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
};

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
