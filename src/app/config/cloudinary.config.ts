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

/**
 * Deletes the Cloudinary asset behind `url`. Best-effort: it never throws, so a
 * failed clean-up can never roll back the operation that made the file
 * obsolete. Callers delete AFTER their own write has succeeded.
 *
 * ONLY OUR OWN ASSETS. A URL that is not on this account's
 * `res.cloudinary.com/<cloud_name>/` — an external image a merchant pasted, a
 * different account — is left alone rather than guessed at.
 *
 * THE ANSWER IS READ. `destroy` does not throw for a wrong public id; it
 * resolves `{ result: "not found" }`. This used to log "deleted" regardless, so
 * a clean-up that never happened looked like one that had. Now only `"ok"` is
 * logged as a deletion, and anything else is logged as what it was.
 */
export const deleteFileFromCloudinary = async (url: string | undefined | null) => {
    if (!url) return;

    // Trimmed: a stray space or CR in the setting must not switch deletion off.
    const ownPrefix = `/${envVars.CLOUDINARY.CLOUDINARY_CLOUD_NAME.trim()}/`;
    let pathname: string;
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== "res.cloudinary.com" || !parsed.pathname.startsWith(ownPrefix)) {
            return;
        }
        pathname = parsed.pathname;
    } catch {
        return; // not a URL at all — nothing of ours to delete
    }

    // `/<cloud>/<resource_type>/upload/[transformations/]v<version>/<public_id>.<ext>`
    const match = pathname.match(/^\/[^/]+\/(image|video|raw)\/upload\/(?:.*?\/)?v\d+\/(.+?)(?:\.[a-zA-Z0-9]+)?$/);
    if (!match) {
        console.warn(`Cloudinary: could not read a public id from ${url}; not deleted`);
        return;
    }
    const [, resourceType, publicId] = match;

    try {
        const response = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        if (response?.result === "ok") {
            console.log(`Cloudinary: deleted ${publicId}`);
        } else {
            console.warn(`Cloudinary: ${publicId} not deleted (${response?.result ?? "no result"})`);
        }
    } catch (error) {
        console.error(`Cloudinary: error deleting ${publicId}:`, error);
    }
};


export const cloudinaryUpload = cloudinary;