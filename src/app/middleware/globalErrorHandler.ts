/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { MulterError } from "multer";
import z from "zod";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { handleZodError } from "../errorHelpers/handleZodError";
import { TErrorResponse, TErrorSources } from "../interfaces/error.interface";

/** Friendlier text for the multer error codes this API can actually trigger (upload routes use `.single`/`.array` with a numeric cap, no field-size/part-count limits configured). */
const MULTER_ERROR_MESSAGES: Partial<Record<MulterError["code"], string>> = {
    LIMIT_FILE_COUNT: "Too many files uploaded",
    LIMIT_UNEXPECTED_FILE: "Unexpected file field in upload",
};



// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const globalErrorHandler = async (err: any, req: Request, res: Response, next: NextFunction) => {
    if (envVars.NODE_ENV === 'development') {
        console.log("Error from Global Error Handler", err);
    }

    // Note: multer is configured with memoryStorage (see multer.config.ts),
    // so req.file/req.files never have a `.path` — that field only exists
    // for diskStorage. An in-memory buffer that errored before/during its
    // own Cloudinary upload was never persisted remotely, so there is
    // nothing to clean up here. (Uploads that succeed and are then
    // replaced/removed are cleaned up explicitly by the owning service,
    // e.g. tenant.service.ts's deleteFileFromCloudinary(existing.photoUrl).)

    let errorSources: TErrorSources[] = []
    let statusCode: number = status.INTERNAL_SERVER_ERROR;
    let message: string = 'Internal Server Error';
    let stack: string | undefined = undefined;

    //Zod Error Patttern
    /*
     error.issues; 
    /* [
      {
        expected: 'string',
        code: 'invalid_type',
        path: [ 'username' , 'password' ], => username password
        message: 'Invalid input: expected string'
      },
      {
        expected: 'number',
        code: 'invalid_type',
        path: [ 'xp' ],
        message: 'Invalid input: expected number'
      }
    ] 
    */

    if (err instanceof z.ZodError) {
        const simplifiedError = handleZodError(err);
        statusCode = simplifiedError.statusCode as number
        message = simplifiedError.message
        errorSources = [...simplifiedError.errorSources]
        stack = err.stack;

    } else if (err instanceof MulterError) {
        statusCode = status.BAD_REQUEST;
        message = MULTER_ERROR_MESSAGES[err.code] ?? err.message;
        stack = err.stack;
        errorSources = [
            {
                path: err.field ?? '',
                message,
            }
        ]

    } else if (err instanceof AppError) {
        statusCode = err.statusCode;
        message = err.message;
        stack = err.stack;
        errorSources = [
            {
                path: '',
                message: err.message
            }
        ]
    }
    else if (err instanceof Error) {
        statusCode = status.INTERNAL_SERVER_ERROR;
        message = err.message
        stack = err.stack;
        errorSources = [
            {
                path: '',
                message: err.message
            }
        ]
    }


    const errorResponse: TErrorResponse = {
        success: false,
        message: message,
        errorSources,
        error: envVars.NODE_ENV === 'development' ? err : undefined,
        stack: envVars.NODE_ENV === 'development' ? stack : undefined,
    }

    res.status(statusCode).json(errorResponse);
}