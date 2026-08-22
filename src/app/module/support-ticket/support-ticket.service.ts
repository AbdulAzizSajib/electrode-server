import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { NotificationType } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { IQueryParams } from "../../interfaces/query.interface";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import {
    ICreateSupportMessagePayload,
    ICreateSupportTicketPayload,
    IUpdateSupportTicketPayload,
} from "./support-ticket.interface";

const TICKET_INCLUDE = {
    customer: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
    assignedTo: { select: { id: true, name: true, email: true } },
};

const isStaffRole = (role: RoleName) =>
    role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF;

const generateTicketNumber = () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TCK-${datePart}-${randomPart}`;
};

const generateUniqueTicketNumber = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateTicketNumber();
        const existing = await prisma.supportTicket.findUnique({
            where: { ticketNumber: candidate },
            select: { id: true },
        });
        if (!existing) {
            return candidate;
        }
    }
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to generate a unique ticket number");
};

const createTicket = async (userId: string, payload: ICreateSupportTicketPayload) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    const ticketNumber = await generateUniqueTicketNumber();

    return prisma.supportTicket.create({
        data: { ticketNumber, customerId: customer.id, ...payload },
        include: TICKET_INCLUDE,
    });
};

const getTickets = async (userId: string, role: RoleName, queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.supportTicket, queryParams, {
        searchableFields: ["ticketNumber", "subject"],
        filterableFields: ["status", "priority", "assignedToId"],
    });

    queryBuilder.search().filter().sort().paginate().include(TICKET_INCLUDE);

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        queryBuilder.where({ customerId: customer.id });
    }

    return queryBuilder.execute();
};

const getTicketOrThrow = async (ticketId: string) => {
    const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: TICKET_INCLUDE,
    });

    if (!ticket) {
        throw new AppError(status.NOT_FOUND, "Support ticket not found");
    }

    return ticket;
};

/** Ticket detail/message access: staff (OWNER/ADMIN/STAFF) or the ticket's own customer — 404, not 403, for anyone else (mirrors return/order scoping). */
const assertTicketAccess = async (userId: string, role: RoleName, ticketId: string) => {
    const ticket = await getTicketOrThrow(ticketId);

    if (isStaffRole(role)) {
        return ticket;
    }

    if (ticket.customer.userId !== userId) {
        throw new AppError(status.NOT_FOUND, "Support ticket not found");
    }

    return ticket;
};

const getTicketById = async (userId: string, role: RoleName, ticketId: string) => {
    return assertTicketAccess(userId, role, ticketId);
};

const updateTicket = async (ticketId: string, payload: IUpdateSupportTicketPayload) => {
    await getTicketOrThrow(ticketId);

    return prisma.supportTicket.update({
        where: { id: ticketId },
        data: payload,
        include: TICKET_INCLUDE,
    });
};

/**
 * Messages are scoped to participants: the ticket's owning customer, its
 * `assignedTo` staff user, or any OWNER/ADMIN — per `api/support-and-admin`
 * spec. A STAFF user not assigned to the ticket is treated the same as an
 * unrelated customer (404), since the spec only names "the assignedTo User
 * (or any OWNER/ADMIN)", not staff in general.
 */
const assertMessageParticipant = async (userId: string, role: RoleName, ticketId: string) => {
    const ticket = await getTicketOrThrow(ticketId);

    const isOwningCustomer = ticket.customer.userId === userId;
    const isOwnerOrAdmin = role === RoleName.OWNER || role === RoleName.ADMIN;
    const isAssignedStaff = role === RoleName.STAFF && ticket.assignedTo?.id === userId;

    if (!isOwningCustomer && !isOwnerOrAdmin && !isAssignedStaff) {
        throw new AppError(status.NOT_FOUND, "Support ticket not found");
    }

    return ticket;
};

/**
 * Notifies "the other participant" (per `api/support-and-admin` spec): the
 * customer if staff sent the message; the assigned staff user — or every
 * OWNER/ADMIN if the ticket is unassigned — if the customer sent it.
 */
const notifyOtherParticipant = async (
    ticket: { ticketNumber: string; customer: { userId: string | null }; assignedTo: { id: string } | null },
    senderId: string,
) => {
    const senderIsCustomer = ticket.customer.userId === senderId;

    if (senderIsCustomer) {
        if (ticket.assignedTo) {
            await NotificationService.createNotification(
                ticket.assignedTo.id,
                NotificationType.SUPPORT,
                "New support ticket message",
                `New message on ticket ${ticket.ticketNumber}.`,
            );
        } else {
            await NotificationService.notifyOwnersAndAdmins(
                NotificationType.SUPPORT,
                "New support ticket message",
                `New message on unassigned ticket ${ticket.ticketNumber}.`,
            );
        }
    } else if (ticket.customer.userId) {
        await NotificationService.createNotification(
            ticket.customer.userId,
            NotificationType.SUPPORT,
            "New reply on your support ticket",
            `New message on ticket ${ticket.ticketNumber}.`,
        );
    }
};

const createMessage = async (
    userId: string,
    role: RoleName,
    ticketId: string,
    payload: ICreateSupportMessagePayload,
) => {
    const ticket = await assertMessageParticipant(userId, role, ticketId);

    const message = await prisma.supportMessage.create({
        data: {
            ticketId,
            senderId: userId,
            message: payload.message,
            attachments: payload.attachments,
        },
    });

    await notifyOtherParticipant(ticket, userId);

    return message;
};

const getMessages = async (userId: string, role: RoleName, ticketId: string) => {
    await assertMessageParticipant(userId, role, ticketId);

    return prisma.supportMessage.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { id: true, name: true, email: true } } },
    });
};

export const SupportTicketService = {
    createTicket,
    getTickets,
    getTicketById,
    updateTicket,
    createMessage,
    getMessages,
};
