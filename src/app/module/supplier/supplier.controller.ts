import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { SupplierService } from "./supplier.service";

const createSupplier = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierService.createSupplier(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Supplier created successfully",
        data: result,
    });
});

const getSuppliers = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await SupplierService.getSuppliers(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Suppliers fetched successfully",
        data,
        meta,
    });
});

const getSupplierById = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierService.getSupplierById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Supplier fetched successfully",
        data: result,
    });
});

const updateSupplier = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierService.updateSupplier(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Supplier updated successfully",
        data: result,
    });
});

const deleteSupplier = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierService.deleteSupplier(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Supplier deleted successfully",
        data: result,
    });
});

export const SupplierController = {
    createSupplier,
    getSuppliers,
    getSupplierById,
    updateSupplier,
    deleteSupplier,
};
