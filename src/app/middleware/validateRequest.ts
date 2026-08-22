import { NextFunction, Request, Response } from "express";
import z from "zod";

export const validateRequest = (zodSchema: z.ZodObject) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.body?.data) {
            req.body = JSON.parse(req.body.data);
        }

        const parsedResult = zodSchema.safeParse(req.body);

        if (!parsedResult.success) {
            return next(parsedResult.error);
        }

        // sanitize: replace req.body with parsed (stripped of unknown fields)
        req.body = parsedResult.data;

        next();
    };
};
