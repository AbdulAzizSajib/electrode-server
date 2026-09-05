import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { SupplierPaymentService } from "./supplier-payment.service";

const recordPayment = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierPaymentService.recordPayment(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Supplier payment recorded successfully",
        data: result,
    });
});

const getPurchaseOrderPayments = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierPaymentService.listPayments(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Supplier payments fetched successfully",
        data: result,
    });
});

const updatePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierPaymentService.updatePayment(
        req.user.userId,
        req.params.id as string,
        req.params.paymentId as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Supplier payment updated successfully",
        data: result,
    });
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await SupplierPaymentService.deletePayment(
        req.user.userId,
        req.params.id as string,
        req.params.paymentId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Supplier payment deleted successfully",
        data: result,
    });
});

export const SupplierPaymentController = {
    recordPayment,
    getPurchaseOrderPayments,
    updatePayment,
    deletePayment,
};
