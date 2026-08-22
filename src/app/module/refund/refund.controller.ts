import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { RefundService } from "./refund.service";

const createRefund = catchAsync(async (req: Request, res: Response) => {
    const result = await RefundService.createRefund(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Refund created successfully",
        data: result,
    });
});

const getRefunds = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RefundService.getRefunds(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Refunds fetched successfully",
        data,
        meta,
    });
});

export const RefundController = {
    createRefund,
    getRefunds,
};
