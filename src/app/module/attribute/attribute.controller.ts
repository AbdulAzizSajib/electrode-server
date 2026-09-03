import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import {
    ICreateAttributePayload,
    IUpdateAttributePayload,
} from "./attribute.interface";
import { AttributeService } from "./attribute.service";

/**
 * `?force=1` confirms a destructive edit the service would otherwise refuse —
 * removing a value, or deleting an attribute, that products still sell. The
 * refusal names how many products are affected, so the admin can ask before
 * retrying with this.
 */
const isForced = (req: Request) => req.query.force === "1" || req.query.force === "true";

const createAttribute = catchAsync(async (req: Request, res: Response) => {
    const result = await AttributeService.createAttribute(
        req.user.userId,
        req.body as ICreateAttributePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Attribute created successfully",
        data: result,
    });
});

const updateAttribute = catchAsync(async (req: Request, res: Response) => {
    const result = await AttributeService.updateAttribute(
        req.user.userId,
        req.params.id as string,
        req.body as IUpdateAttributePayload,
        { force: isForced(req) },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Attribute updated successfully",
        data: result,
    });
});

const deleteAttribute = catchAsync(async (req: Request, res: Response) => {
    const result = await AttributeService.deleteAttribute(
        req.user.userId,
        req.params.id as string,
        { force: isForced(req) },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            result.affectedProducts > 0
                ? `Attribute deleted. ${result.affectedProducts} product(s) lost these choices.`
                : "Attribute deleted successfully",
        data: result.attribute,
    });
});

const getAttributes = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await AttributeService.getAttributes(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Attributes fetched successfully",
        data,
        meta,
    });
});

const getAttributeById = catchAsync(async (req: Request, res: Response) => {
    const result = await AttributeService.getAttributeById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Attribute fetched successfully",
        data: result,
    });
});

/** Unpaginated, for the product form's attribute picker. */
const getAllAttributes = catchAsync(async (_req: Request, res: Response) => {
    const result = await AttributeService.getAllAttributes();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Attributes fetched successfully",
        data: result,
    });
});

export const AttributeController = {
    createAttribute,
    updateAttribute,
    deleteAttribute,
    getAttributes,
    getAttributeById,
    getAllAttributes,
};
