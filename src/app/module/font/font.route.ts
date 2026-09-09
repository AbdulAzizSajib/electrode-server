import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { FontController } from "./font.controller";
import { createFontZodSchema, updateFontZodSchema } from "./font.validation";

const router = Router();

/*
 * The whole library is admin-only, reads included — unlike Testimonial or
 * Banner, which have a public arm. Nothing on the storefront reads this
 * endpoint: the storefront gets its typeface from the theme in
 * GET /settings/public, already denormalised to { family, url }. Exposing the
 * catalogue publicly would publish every font a merchant has ever considered
 * with no page that renders it.
 *
 * Literal segments above the parameterised one — Express matches in
 * declaration order, so `/fonts/all` would otherwise be read as an id.
 */

router.get("/all", checkAuth(RoleName.OWNER, RoleName.ADMIN), FontController.getAllFonts);

router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), FontController.getFonts);

router.get("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), FontController.getFontById);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createFontZodSchema),
    FontController.createFont,
);

router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateFontZodSchema),
    FontController.updateFont,
);

router.delete("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), FontController.deleteFont);

export const FontRoutes = router;
