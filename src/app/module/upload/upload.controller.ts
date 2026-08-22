import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";

/**
 * Stateless from the API's perspective — Cloudinary is the store of record
 * for the asset itself, so there's no Prisma model/service layer here,
 * matching how auth.controller.ts's avatar upload works.
 */
const uploadImage = catchAsync(async (req: Request, res: Response) => {
    if (!req.file) {
        throw new AppError(status.BAD_REQUEST, "An image file is required");
    }

    const uploadResult = await uploadFileToCloudinary(req.file.buffer, req.file.originalname);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Image uploaded successfully",
        data: { url: uploadResult.secure_url },
    });
});

export const UploadController = {
    uploadImage,
};
