import { NextFunction, Request, Response } from "express";
import z from "zod";

/**
 * Query-string counterpart to `validateRequest`.
 *
 * Two reasons it is a separate middleware rather than a flag on that one:
 *
 * 1. Express 5 exposes `req.query` through a getter with no setter, so the
 *    parsed value cannot be written back over it the way `validateRequest`
 *    replaces `req.body`. It is attached as `req.validatedQuery` instead.
 * 2. `validateRequest` is typed `z.ZodObject`, and a schema carrying a
 *    `.refine()` — which every report range schema does, to reject a backwards
 *    range — is a `ZodType`, not a `ZodObject`.
 *
 * Reports rely on this instead of `QueryBuilder`'s `filterableFields`, which
 * DROPS unknown params silently. For a report that means confidently returning
 * a wrong number; this returns a 400.
 */
export const validateQuery = <T>(zodSchema: z.ZodType<T>) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const parsedResult = zodSchema.safeParse(req.query);

        if (!parsedResult.success) {
            return next(parsedResult.error);
        }

        req.validatedQuery = parsedResult.data;

        next();
    };
};
