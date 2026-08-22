import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ShipmentService } from "./shipment.service";

const getOrderShipment = catchAsync(async (req: Request, res: Response) => {
    const result = await ShipmentService.getOrderShipment(
        req.user.userId,
        req.user.role,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipment fetched successfully",
        data: result,
    });
});

const createShipment = catchAsync(async (req: Request, res: Response) => {
    const result = await ShipmentService.createShipment(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Shipment created successfully",
        data: result,
    });
});

const updateShipment = catchAsync(async (req: Request, res: Response) => {
    const result = await ShipmentService.updateShipment(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipment updated successfully",
        data: result,
    });
});

export const ShipmentController = {
    getOrderShipment,
    createShipment,
    updateShipment,
};
