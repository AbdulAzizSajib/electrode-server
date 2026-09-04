import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PageController } from "./page.controller";
import { createPageZodSchema, updatePageZodSchema } from "./page.validation";

const router = Router();

/*
 * Literal segments MUST stay above the `/:slug` mount at the bottom. Express
 * matches in declaration order, so a route registered after it would never be
 * reached — `/pages/admin` would resolve as "the published page whose slug is
 * 'admin'" and 404. Same reason `/customers/me/addresses` sits above
 * `/customers/:id` in routes/index.ts.
 */

// Admin (any status)
router.get("/admin", checkAuth(RoleName.OWNER, RoleName.ADMIN), PageController.getAdminPages);
router.get("/admin/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), PageController.getPageById);
router.get(
    "/reserved-slugs",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    PageController.getReservedSlugs,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createPageZodSchema),
    PageController.createPage,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updatePageZodSchema),
    PageController.updatePage,
);
router.delete("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), PageController.deletePage);

// Public (PUBLISHED only)
router.get("/", PageController.getPublicPages);
router.get("/:slug", PageController.getPublicPageBySlug);

export const PageRoutes = router;
