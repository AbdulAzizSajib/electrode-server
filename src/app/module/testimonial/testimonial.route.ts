import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { TestimonialController } from "./testimonial.controller";
import {
    createTestimonialZodSchema,
    updateTestimonialZodSchema,
} from "./testimonial.validation";

const router = Router();

/*
 * Literal segments above the parameterised ones, for the reason page.route.ts
 * gives: Express matches in declaration order, so `/testimonials/admin` would
 * otherwise be read as an id.
 */

// Admin (any status)
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    TestimonialController.getAdminTestimonials,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    TestimonialController.getTestimonialById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createTestimonialZodSchema),
    TestimonialController.createTestimonial,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateTestimonialZodSchema),
    TestimonialController.updateTestimonial,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    TestimonialController.deleteTestimonial,
);

// Public (PUBLISHED only)
router.get("/", TestimonialController.getPublicTestimonials);

export const TestimonialRoutes = router;
