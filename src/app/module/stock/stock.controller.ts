import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { StockService } from "./stock.service";

const getStock = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await StockService.getStock(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Stock fetched successfully",
        data,
        meta,
    });
});

const adjustStock = catchAsync(async (req: Request, res: Response) => {
    const result = await StockService.adjustStock(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Stock adjusted successfully",
        data: result,
    });
});

const getStockMovements = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await StockService.getStockMovements(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Stock movements fetched successfully",
        data,
        meta,
    });
});

export const StockController = {
    getStock,
    adjustStock,
    getStockMovements,
};
