import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { LandingPageController } from "./landing-page.controller";
import {
    createLandingPageZodSchema,
    landingPageQuoteZodSchema,
    placeLandingPageOrderZodSchema,
    updateLandingPageZodSchema,
} from "./landing-page.validation";

const router = Router();

/*
 * PUBLIC ROUTES FIRST.
 *
 * Everything a shopper reaches is namespaced under the literal `by-slug`
 * segment so it can never collide with the admin `/:id` routes below — the same
 * discipline `/settings/public` and `/orders/track` already use, and the reason
 * a landing page is not simply served from `/landing-pages/:slug`.
 *
 * All three are unauthenticated by design: they are what an ad's traffic hits.
 * PUBLISHED-only filtering happens in the service, so a DRAFT page is a 404
 * here rather than a 403 — an unpublished campaign must not be discoverable by
 * probing slugs.
 */
router.get("/by-slug/:slug", LandingPageController.getPublicLandingPage);

router.post(
    "/by-slug/:slug/quote",
    validateRequest(landingPageQuoteZodSchema),
    LandingPageController.quoteLandingPageOrder,
);

/*
 * No `optionalAuth`, unlike `/orders`. A campaign order is ALWAYS a guest
 * cash-on-delivery order — the page has no login and no address book, so there
 * is no authenticated experience to resolve, and reading a session would only
 * make the page behave differently for a signed-in merchant testing it than for
 * the ad traffic it exists for. The customer is resolved by phone instead, so
 * an order from a number that already has an account still attaches to it. See
 * landing-page.controller.ts.
 */
router.post(
    "/by-slug/:slug/order",
    validateRequest(placeLandingPageOrderZodSchema),
    LandingPageController.placeLandingPageOrder,
);

/*
 * Preview: any status, by slug, behind auth. Separate from the public read
 * rather than a `?preview=true` flag on it, which would be one forgotten check
 * away from publishing every draft.
 */
router.get(
    "/preview/:slug",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    LandingPageController.previewLandingPage,
);

// Registered before "/:id" so that path never captures the literal segment.
router.get(
    "/published",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    LandingPageController.getPublishedSummaries,
);

/*
 * ADMIN ROUTES. Owner and admin only, matching the rest of the UI/CMS modules —
 * a landing page is storefront content that also takes money, so it is not
 * staff-editable.
 */
router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), LandingPageController.getAdminLandingPages);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createLandingPageZodSchema),
    LandingPageController.createLandingPage,
);

router.get("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), LandingPageController.getLandingPageById);

router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateLandingPageZodSchema),
    LandingPageController.updateLandingPage,
);

router.post(
    "/:id/duplicate",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    LandingPageController.duplicateLandingPage,
);

router.delete("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), LandingPageController.deleteLandingPage);

export const LandingPageRoutes = router;
