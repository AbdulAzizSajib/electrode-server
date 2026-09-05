import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { PurchaseOrderService } from "./purchase-order.service";

const createPurchaseOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await PurchaseOrderService.createPurchaseOrder(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Purchase order created successfully",
        data: result,
    });
});

const getPurchaseOrders = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await PurchaseOrderService.getPurchaseOrders(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Purchase orders fetched successfully",
        data,
        meta,
    });
});

const getPurchaseOrderById = catchAsync(async (req: Request, res: Response) => {
    const result = await PurchaseOrderService.getPurchaseOrderById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Purchase order fetched successfully",
        data: result,
    });
});

const updatePurchaseOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await PurchaseOrderService.updatePurchaseOrder(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Purchase order updated successfully",
        data: result,
    });
});

const deletePurchaseOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await PurchaseOrderService.deletePurchaseOrder(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Purchase order deleted successfully",
        data: result,
    });
});

const receivePurchaseOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await PurchaseOrderService.receivePurchaseOrder(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Purchase order received successfully",
        data: result,
    });
});

export const PurchaseOrderController = {
    createPurchaseOrder,
    getPurchaseOrders,
    getPurchaseOrderById,
    updatePurchaseOrder,
    deletePurchaseOrder,
    receivePurchaseOrder,
};
