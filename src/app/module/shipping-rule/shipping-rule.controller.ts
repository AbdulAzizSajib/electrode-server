import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import {
    ICreateShippingRulePayload,
    IUpdateShippingRulePayload,
} from "./shipping-rule.interface";
import { ShippingRuleService } from "./shipping-rule.service";

const createShippingRule = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingRuleService.createShippingRule(
        req.user.userId,
        req.body as ICreateShippingRulePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Shipping rule created successfully",
        data: result,
    });
});

const updateShippingRule = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingRuleService.updateShippingRule(
        req.user.userId,
        req.params.id as string,
        req.body as IUpdateShippingRulePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping rule updated successfully",
        data: result,
    });
});

const deleteShippingRule = catchAsync(async (req: Request, res: Response) => {
    // `?reassign_to=<id>` names where products using this rule should move.
    const reassignTo = req.query.reassign_to;
    const result = await ShippingRuleService.deleteShippingRule(
        req.user.userId,
        req.params.id as string,
        typeof reassignTo === "string" ? reassignTo : undefined,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            result.reassignedProducts > 0
                ? `Shipping rule deleted. ${result.reassignedProducts} product(s) moved to the replacement.`
                : "Shipping rule deleted successfully",
        data: result.shippingRule,
    });
});

const getShippingRules = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ShippingRuleService.getShippingRules(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping rules fetched successfully",
        data,
        meta,
    });
});

const getShippingRuleById = catchAsync(async (req: Request, res: Response) => {
    const result = await ShippingRuleService.getShippingRuleById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping rule fetched successfully",
        data: result,
    });
});

const getAllShippingRules = catchAsync(async (_req: Request, res: Response) => {
    const result = await ShippingRuleService.getAllShippingRules();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Shipping rules fetched successfully",
        data: result,
    });
});

export const ShippingRuleController = {
    createShippingRule,
    updateShippingRule,
    deleteShippingRule,
    getShippingRules,
    getShippingRuleById,
    getAllShippingRules,
};
