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

/**
 * Uploads a product video and its poster frame together.
 *
 * Two files in one request rather than two round trips: a video without a
 * thumbnail shows a black rectangle until it plays, so they are only useful as
 * a pair and should fail or succeed as one.
 *
 * The thumbnail is optional — Cloudinary can derive a frame — but when supplied
 * it is the merchant's choice of frame and wins.
 */
const uploadVideo = catchAsync(async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const video = files?.video?.[0];
    const thumbnail = files?.thumbnail?.[0];

    if (!video) {
        throw new AppError(status.BAD_REQUEST, "A video file is required");
    }

    const uploaded = await uploadFileToCloudinary(video.buffer, video.originalname);

    const uploadedThumbnail = thumbnail
        ? await uploadFileToCloudinary(thumbnail.buffer, thumbnail.originalname)
        : null;

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Video uploaded successfully",
        data: {
            url: uploaded.secure_url,
            // Cloudinary can render a frame from the video itself, so a merchant
            // who supplies no poster still gets one rather than a black box.
            thumbnailUrl:
                uploadedThumbnail?.secure_url ??
                uploaded.secure_url.replace(/\.[^./]+$/, ".jpg"),
        },
    });
});

export const UploadController = {
    uploadImage,
    uploadVideo,
};
