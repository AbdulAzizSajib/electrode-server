import { CourierProvider } from "../../generated/prisma/client";
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
            /**
             * The courier whose webhook token authenticated this request, set by
             * `requireWebhookToken`.
             *
             * Carried on the request rather than re-derived from the URL in the
             * controller, so the provider that was AUTHENTICATED and the
             * provider the payload is interpreted as cannot drift apart. Present
             * only on the webhook routes. See courier.guard.ts.
             */
            courierProvider? : CourierProvider
        }
    }
}