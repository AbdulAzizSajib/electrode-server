import { IRequestUser } from "./requestUser.interface";


declare global {
    namespace Express{
        interface Request {
            user : IRequestUser
            /**
             * Query string after Zod parsing, set by the `validateQuery`
             * middleware. Separate from `req.query` because Express 5 exposes
             * that through a getter with no setter — see validateQuery.ts.
             */
            validatedQuery? : unknown
        }
    }
}