import status from "http-status";
import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import AppError from "../errorHelpers/AppError";

// Use in-memory storage so the file buffer is available in the controller,
// then upload it to Cloudinary via uploadFileToCloudinary (native v2 upload_stream).
const storage = multer.memoryStorage();

const MB = 1024 * 1024;

/**
 * Per-file ceilings. They match Cloudinary's own per-file limits for images
 * and video: a larger file would be refused there anyway, only later, after
 * buffering it in memory, and as a 500. Refusing it here is a 413 the admin
 * can explain. See improve-site-performance design D7.
 */
export const IMAGE_MAX_BYTES = 10 * MB;
export const VIDEO_MAX_BYTES = 100 * MB;

/**
 * Accepts a file whose MIME type matches one of `accepted` (a `type/*`
 * wildcard or an exact type), and refuses anything else with a 415 naming
 * what this field takes.
 */
const acceptOnly =
    (accepted: string[], label: string) =>
    (_req: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
        const ok = accepted.some((type) =>
            type.endsWith("/*")
                ? file.mimetype.startsWith(type.slice(0, -1))
                : file.mimetype === type,
        );

        if (ok) return callback(null, true);

        callback(
            new AppError(
                status.UNSUPPORTED_MEDIA_TYPE,
                `"${file.originalname}" is not a supported file. This field accepts ${label}.`,
            ),
        );
    };

/** Product, category, brand, banner and avatar images. */
export const imageUpload = multer({
    storage,
    limits: { fileSize: IMAGE_MAX_BYTES },
    fileFilter: acceptOnly(["image/*"], "images (JPG, PNG, WebP, GIF, SVG)"),
});

/** The general upload endpoint: an image, or a PDF. */
export const fileUpload = multer({
    storage,
    limits: { fileSize: IMAGE_MAX_BYTES },
    fileFilter: acceptOnly(["image/*", "application/pdf"], "images or PDF"),
});

/**
 * A product video and its poster. multer has one `fileSize` per instance, so
 * this one is sized for the video; the poster's tighter image ceiling is
 * enforced in `UploadController.uploadVideo`.
 */
export const mediaUpload = multer({
    storage,
    limits: { fileSize: VIDEO_MAX_BYTES },
    fileFilter: (req, file, callback) =>
        file.fieldname === "video"
            ? acceptOnly(["video/*"], "video files (MP4, WebM, MOV)")(req, file, callback)
            : acceptOnly(["image/*"], "images (JPG, PNG, WebP)")(req, file, callback),
});

/**
 * Database backup restore. Deliberately unlimited and unfiltered: a backup is
 * as large as the shop's data, and the restore flow validates the file itself.
 */
export const backupUpload = multer({ storage });
