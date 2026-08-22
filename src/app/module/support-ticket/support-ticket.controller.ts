import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { SupportTicketService } from "./support-ticket.service";

const createTicket = catchAsync(async (req: Request, res: Response) => {
    const result = await SupportTicketService.createTicket(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Support ticket created successfully",
        data: result,
    });
});

const getTickets = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await SupportTicketService.getTickets(
        req.user.userId,
        req.user.role,
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Support tickets fetched successfully",
        data,
        meta,
    });
});

const getTicketById = catchAsync(async (req: Request, res: Response) => {
    const result = await SupportTicketService.getTicketById(
        req.user.userId,
        req.user.role,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Support ticket fetched successfully",
        data: result,
    });
});

const updateTicket = catchAsync(async (req: Request, res: Response) => {
    const result = await SupportTicketService.updateTicket(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Support ticket updated successfully",
        data: result,
    });
});

const createMessage = catchAsync(async (req: Request, res: Response) => {
    const result = await SupportTicketService.createMessage(
        req.user.userId,
        req.user.role,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Message sent successfully",
        data: result,
    });
});

const getMessages = catchAsync(async (req: Request, res: Response) => {
    const result = await SupportTicketService.getMessages(
        req.user.userId,
        req.user.role,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Messages fetched successfully",
        data: result,
    });
});

export const SupportTicketController = {
    createTicket,
    getTickets,
    getTicketById,
    updateTicket,
    createMessage,
    getMessages,
};
