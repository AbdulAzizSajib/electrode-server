import multer from "multer";

// Use in-memory storage so the file buffer is available in the controller,
// then upload it to Cloudinary via uploadFileToCloudinary (native v2 upload_stream).
const storage = multer.memoryStorage();

export const multerUpload = multer({ storage });
