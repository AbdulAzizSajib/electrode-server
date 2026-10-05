import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import status from "http-status";
import AppError from "../errorHelpers/AppError";
import { envVars } from "./env";

cloudinary.config({
    cloud_name: envVars.CLOUDINARY.CLOUDINARY_CLOUD_NAME,
    api_key: envVars.CLOUDINARY.CLOUDINARY_API_KEY,
    api_secret: envVars.CLOUDINARY.CLOUDINARY_API_SECRET,
})

/**
 * Photographic formats Cloudinary re-encodes well. Vector (SVG), icon (ICO)
 * and animated (GIF) uploads are stored as they arrive: rasterising a logo or
 * flattening an animation would be a loss, and they are small anyway.
 */
const RESIZABLE_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/tiff",
    "image/bmp",
]);

/**
 * Longest side an uploaded image is stored at. Covers the widest render (a
 * full-bleed hero on a 1920px screen) at 1x; every smaller size the storefront
 * asks for is derived from this rather than from a 6000px phone original,
 * which is what made each first-time derivative slow.
 */
const STORED_IMAGE_MAX_PX = 2000;

export const uploadFileToCloudinary = async (
    buffer : Buffer,
    fileName: string,
    mimeType: string,
) : Promise<UploadApiResponse> =>{

    if(!buffer || !fileName) {
        throw new AppError(status.BAD_REQUEST, "File buffer and file name are required for upload");
    }

    const extension = fileName.split(".").pop()?.toLocaleLowerCase();

    const fileNameWithoutExtension = fileName
        .split(".")
        .slice(0, -1)
        .join(".")
        .toLowerCase()
        .replace(/\s+/g, "-")
        // eslint-disable-next-line no-useless-escape
        .replace(/[^a-z0-9\-]/g, "");

    const uniqueName =
        Math.random().toString(36).substring(2) +
        "-" +
        Date.now() +
        "-" +
        fileNameWithoutExtension;

    const folder = extension === "pdf" ? "pdfs" : "images";


    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                public_id: `Bariyan/${folder}/${uniqueName}`,
                folder : `Bariyan/${folder}`,
                // An incoming transformation: Cloudinary stores the result as
                // the asset. `limit` only ever shrinks, never upscales.
                ...(RESIZABLE_IMAGE_TYPES.has(mimeType) && {
                    transformation: [
                        {
                            width: STORED_IMAGE_MAX_PX,
                            height: STORED_IMAGE_MAX_PX,
                            crop: "limit",
                            quality: "auto",
                        },
                    ],
                }),
            },
            (error, result) => {
                if(error){
                    return reject(new AppError(status.INTERNAL_SERVER_ERROR, "Failed to upload file to Cloudinary"));
                }
                resolve(result as UploadApiResponse);
            }
        ).end(buffer);
    })


}

export const deleteFileFromCloudinary = async (url: string | undefined | null) => {

    // Best-effort helper — nothing to delete if there's no URL to work with.
    if (!url) return;

    try {
        const regex = /\/v\d+\/(.+?)(?:\.[a-zA-Z0-9]+)+$/;

        const match = url.match(regex);

        if (match && match[1]) {
            const publicId = match[1];

            await cloudinary.uploader.destroy(
                publicId, {
                resource_type: "image"
            }
            )

            console.log(`File ${publicId} deleted from cloudinary`);
        }

    } catch (error) {
        // Best-effort cleanup: a failed old-file deletion must not roll back the
        // main operation (tenant update/delete). Log and move on.
        console.error("Error deleting file from Cloudinary:", error);
    }
}


export const cloudinaryUpload = cloudinary;