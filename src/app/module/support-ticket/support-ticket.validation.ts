import z from "zod";

export const createSupportTicketZodSchema = z.object({
    subject: z.string().min(2).max(200),
    description: z.string().min(2).max(5000),
});

export const updateSupportTicketZodSchema = z.object({
    status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    assignedToId: z.string().nullable().optional(),
});

export const createSupportMessageZodSchema = z.object({
    message: z.string().min(1).max(5000),
    attachments: z.any().optional(),
});
