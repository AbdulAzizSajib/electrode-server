import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ICreateTaxRulePayload, IUpdateTaxRulePayload } from "./tax-rule.interface";
import { TaxRuleService } from "./tax-rule.service";

const createTaxRule = catchAsync(async (req: Request, res: Response) => {
    const result = await TaxRuleService.createTaxRule(
        req.user.userId,
        req.body as ICreateTaxRulePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Tax rule created successfully",
        data: result,
    });
});

const updateTaxRule = catchAsync(async (req: Request, res: Response) => {
    const result = await TaxRuleService.updateTaxRule(
        req.user.userId,
        req.params.id as string,
        req.body as IUpdateTaxRulePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Tax rule updated successfully",
        data: result,
    });
});

const deleteTaxRule = catchAsync(async (req: Request, res: Response) => {
    // `?reassign_to=<id>` names where products using this rule should move.
    const reassignTo = req.query.reassign_to;
    const result = await TaxRuleService.deleteTaxRule(
        req.user.userId,
        req.params.id as string,
        typeof reassignTo === "string" ? reassignTo : undefined,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            result.reassignedProducts > 0
                ? `Tax rule deleted. ${result.reassignedProducts} product(s) moved to the replacement.`
                : "Tax rule deleted successfully",
        data: result.taxRule,
    });
});

const getTaxRules = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await TaxRuleService.getTaxRules(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Tax rules fetched successfully",
        data,
        meta,
    });
});

const getTaxRuleById = catchAsync(async (req: Request, res: Response) => {
    const result = await TaxRuleService.getTaxRuleById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Tax rule fetched successfully",
        data: result,
    });
});

const getAllTaxRules = catchAsync(async (_req: Request, res: Response) => {
    const result = await TaxRuleService.getAllTaxRules();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Tax rules fetched successfully",
        data: result,
    });
});

export const TaxRuleController = {
    createTaxRule,
    updateTaxRule,
    deleteTaxRule,
    getTaxRules,
    getTaxRuleById,
    getAllTaxRules,
};
