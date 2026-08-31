import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { PaymentService } from "./payment.service";

const recordPayment = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.recordPayment(
        req.user.userId,
        req.user.role,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Payment recorded successfully",
        data: result,
    });
});

const updatePaymentStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.updatePaymentStatus(
        req.user.userId,
        req.user.role,
        req.params.id as string,
        req.params.paymentId as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Payment status updated successfully",
        data: result,
    });
});

const getOrderPayments = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentService.getOrderPayments(
        req.user.userId,
        req.user.role,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Payments fetched successfully",
        data: result,
    });
});

export const PaymentController = {
    recordPayment,
    updatePaymentStatus,
    getOrderPayments,
};
