import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { WarehouseService } from "./warehouse.service";

const createWarehouse = catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.createWarehouse(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Warehouse created successfully",
        data: result,
    });
});

const getWarehouses = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await WarehouseService.getWarehouses(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Warehouses fetched successfully",
        data,
        meta,
    });
});

const getWarehouseById = catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.getWarehouseById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Warehouse fetched successfully",
        data: result,
    });
});

const updateWarehouse = catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.updateWarehouse(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Warehouse updated successfully",
        data: result,
    });
});

const deleteWarehouse = catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.deleteWarehouse(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Warehouse deleted successfully",
        data: result,
    });
});

export const WarehouseController = {
    createWarehouse,
    getWarehouses,
    getWarehouseById,
    updateWarehouse,
    deleteWarehouse,
};
