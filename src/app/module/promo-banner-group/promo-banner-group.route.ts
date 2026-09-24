import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PromoBannerGroupController } from "./promo-banner-group.controller";
import {
    createPromoBannerGroupZodSchema,
    reorderPromoBannerGroupsZodSchema,
    updatePromoBannerGroupZodSchema,
} from "./promo-banner-group.validation";

const router = Router();

/*
 * `/reorder` ABOVE `/:id`, for the reason page.route.ts and testimonial.route.ts
 * both give: Express matches in declaration order, so a literal segment
 * registered after a parameterised one is read as an id and never reached.
 */
router.patch(
    "/reorder",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(reorderPromoBannerGroupsZodSchema),
    PromoBannerGroupController.reorderPromoBannerGroups,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createPromoBannerGroupZodSchema),
    PromoBannerGroupController.createPromoBannerGroup,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updatePromoBannerGroupZodSchema),
    PromoBannerGroupController.updatePromoBannerGroup,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    PromoBannerGroupController.deletePromoBannerGroup,
);

/*
 * Public reads, LAST.
 *
 * The storefront needs the groups to render the homepage and is unauthenticated,
 * so these carry no `checkAuth` — matching the public banner listing they are
 * read alongside. There is nothing private on a group: a name, a tile count and
 * a position, all of which are visible on the rendered page anyway.
 */
router.get("/", PromoBannerGroupController.getPromoBannerGroups);
router.get("/:id", PromoBannerGroupController.getPromoBannerGroupById);

export const PromoBannerGroupRoutes = router;
