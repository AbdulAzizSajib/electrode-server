import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { AuditLogService } from "./audit-log.service";

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await AuditLogService.getAuditLogs(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Audit logs fetched successfully",
        data,
        meta,
    });
});

export const AuditLogController = {
    getAuditLogs,
};
