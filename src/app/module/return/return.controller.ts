import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ReturnService } from "./return.service";

const createReturn = catchAsync(async (req: Request, res: Response) => {
    const result = await ReturnService.createReturn(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Return request created successfully",
        data: result,
    });
});

const getReturns = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ReturnService.getReturns(
        req.user.userId,
        req.user.role,
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Return requests fetched successfully",
        data,
        meta,
    });
});

const getReturnById = catchAsync(async (req: Request, res: Response) => {
    const result = await ReturnService.getReturnById(
        req.user.userId,
        req.user.role,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Return request fetched successfully",
        data: result,
    });
});

const updateReturnStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await ReturnService.updateReturnStatus(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Return status updated successfully",
        data: result,
    });
});

export const ReturnController = {
    createReturn,
    getReturns,
    getReturnById,
    updateReturnStatus,
};
