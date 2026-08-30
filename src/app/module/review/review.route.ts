import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ReviewController } from "./review.controller";
import {
    adminReplyZodSchema,
    createReviewZodSchema,
    updateMyReviewZodSchema,
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
// Author-scoped self-service. Kept under a distinct /me prefix rather than
// overloading /:id: PATCH /:id is already the admin reply, and folding two
// different authorization models into one handler is how ownership checks get
// missed. Mirrors the existing /customers/me/addresses convention.
// Registered before /:id so "me" is never captured as a review id.
router.get("/me", checkAuth(...ALL_ROLES), ReviewController.getMyReviews);
router.patch(
    "/me/:id",
    checkAuth(...ALL_ROLES),
    validateRequest(updateMyReviewZodSchema),
    ReviewController.updateMyReview,
);
router.delete("/me/:id", checkAuth(...ALL_ROLES), ReviewController.deleteMyReview);

router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(adminReplyZodSchema),
    ReviewController.replyToReview,
);
// Hard delete is OWNER/ADMIN only — STAFF can moderate status but not destroy
// content, consistent with the role gradient used elsewhere.
router.delete("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), ReviewController.deleteReview);
export const ReviewRoutes = router;
