import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import {
    ICreateCollectionPayload,
    IUpdateCollectionPayload,
} from "./collection.interface";
import { CollectionService } from "./collection.service";

const createCollection = catchAsync(async (req: Request, res: Response) => {
    const result = await CollectionService.createCollection(
        req.user.userId,
        req.body as ICreateCollectionPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Collection created successfully",
        data: result,
    });
});

const updateCollection = catchAsync(async (req: Request, res: Response) => {
    const result = await CollectionService.updateCollection(
        req.user.userId,
        req.params.id as string,
        req.body as IUpdateCollectionPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Collection updated successfully",
        data: result,
    });
});

const deleteCollection = catchAsync(async (req: Request, res: Response) => {
    const result = await CollectionService.deleteCollection(
        req.user.userId,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            result.removedMemberships > 0
                ? `Collection deleted. ${result.removedMemberships} product(s) left it; none were changed otherwise.`
                : "Collection deleted successfully",
        data: result.collection,
    });
});

const getCollections = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await CollectionService.getCollections(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Collections fetched successfully",
        data,
        meta,
    });
});

const getCollectionById = catchAsync(async (req: Request, res: Response) => {
    const result = await CollectionService.getCollectionById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Collection fetched successfully",
        data: result,
    });
});

const getAllCollections = catchAsync(async (_req: Request, res: Response) => {
    const result = await CollectionService.getAllCollections();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Collections fetched successfully",
        data: result,
    });
});

export const CollectionController = {
    createCollection,
    updateCollection,
    deleteCollection,
    getCollections,
    getCollectionById,
    getAllCollections,
};
