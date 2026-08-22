import { Prisma } from "../../../generated/prisma/client";

export interface ICreateSupportTicketPayload {
    subject: string;
    description: string;
}

export interface IUpdateSupportTicketPayload {
    status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    assignedToId?: string | null;
}

export interface ICreateSupportMessagePayload {
    message: string;
    attachments?: Prisma.InputJsonValue;
}
