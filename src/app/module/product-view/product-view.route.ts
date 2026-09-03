import { Router } from "express";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ProductViewController } from "./product-view.controller";
import { recordProductViewZodSchema } from "./product-view.validation";

/**
 * Mounted at /products/:id/views — `req.params.id` (the product id) is
 * inherited from the parent mount path, as in `review.route.ts`.
 *
 * `optionalAuth`, not `checkAuth`: a guest's view counts exactly as a signed-in
 * shopper's does. Being signed in only changes how the viewer is identified for
 * deduplication.
 */
const nestedRouter = Router({ mergeParams: true });

nestedRouter.post(
    "/",
    optionalAuth,
    validateRequest(recordProductViewZodSchema),
    ProductViewController.recordProductView,
);

export const ProductViewNestedRoutes = nestedRouter;
