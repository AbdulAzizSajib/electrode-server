import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ReviewController } from "./review.controller";
import {
    adminReplyZodSchema,
    createReviewZodSchema,
    updateReviewStatusZodSchema,
} from "./review.validation";

// Mounted at /products/:id/reviews — req.params.id (the product id) is inherited from the parent mount path.
const nestedRouter = Router({ mergeParams: true });
nestedRouter.post(
    "/",
    checkAuth(...ALL_ROLES),
    validateRequest(createReviewZodSchema),
    ReviewController.createReview,
);
nestedRouter.get("/", ReviewController.getPublicProductReviews);
export const ReviewNestedRoutes = nestedRouter;

// Mounted at /reviews - admin moderation.
const router = Router();
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    ReviewController.getAdminReviews,
);
router.patch(
    "/:id/status",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(updateReviewStatusZodSchema),
    ReviewController.updateReviewStatus,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(adminReplyZodSchema),
    ReviewController.replyToReview,
);
export const ReviewRoutes = router;
