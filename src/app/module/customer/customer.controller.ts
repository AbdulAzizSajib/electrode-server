import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CustomerService } from "./customer.service";

const getMyAddresses = catchAsync(async (req: Request, res: Response) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(req.user.userId);
    const result = await CustomerService.getMyAddresses(customer.id);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Addresses fetched successfully",
        data: result,
    });
});

const getMyAddressById = catchAsync(async (req: Request, res: Response) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(req.user.userId);
    const result = await CustomerService.getMyAddressById(customer.id, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Address fetched successfully",
        data: result,
    });
});

const createAddress = catchAsync(async (req: Request, res: Response) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(req.user.userId);
    const result = await CustomerService.createAddress(customer.id, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Address created successfully",
        data: result,
    });
});

const updateAddress = catchAsync(async (req: Request, res: Response) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(req.user.userId);
    const result = await CustomerService.updateAddress(
        customer.id,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Address updated successfully",
        data: result,
    });
});

const setDefaultAddress = catchAsync(async (req: Request, res: Response) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(req.user.userId);
    const result = await CustomerService.setDefaultAddress(customer.id, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Default address updated successfully",
        data: result,
    });
});

const deleteAddress = catchAsync(async (req: Request, res: Response) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(req.user.userId);
    const result = await CustomerService.deleteAddress(customer.id, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Address deleted successfully",
        data: result,
    });
});

export const CustomerController = {
    getMyAddresses,
    getMyAddressById,
    createAddress,
    updateAddress,
    setDefaultAddress,
    deleteAddress,
};
