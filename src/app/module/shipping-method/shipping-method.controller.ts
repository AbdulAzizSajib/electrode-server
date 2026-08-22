import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ShippingMethodService } from "./shipping-method.service";

const createShippingMethod = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingMethodService.createShippingMethod(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Shipping method created successfully",
        data: result,
    });
});

const getPublicShippingMethods = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingMethodService.getPublicShippingMethods();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping methods fetched successfully",
        data: result,
    });
});

const getAdminShippingMethods = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ShippingMethodService.getAdminShippingMethods(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping methods fetched successfully",
        data,
        meta,
    });
});

const getAdminShippingMethodById = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingMethodService.getAdminShippingMethodById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping method fetched successfully",
        data: result,
    });
});

const updateShippingMethod = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingMethodService.updateShippingMethod(
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping method updated successfully",
        data: result,
    });
});

const deleteShippingMethod = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingMethodService.deleteShippingMethod(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping method deleted successfully",
        data: result,
    });
});

export const ShippingMethodController = {
    createShippingMethod,
    getPublicShippingMethods,
    getAdminShippingMethods,
    getAdminShippingMethodById,
    updateShippingMethod,
    deleteShippingMethod,
};
