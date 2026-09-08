import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { SeoController } from "./seo.controller";

const router = Router();

/*
 * Public, like /settings/public and for the same reason: the storefront builds
 * its sitemap from this before any session exists. Nothing here is private —
 * every slug it returns is already a public URL, and the endpoint returns only
 * published records. The per-type toggles and the global noindex switch are
 * applied server-side, so a merchant who excluded a content type cannot have it
 * leak through a client that forgot to check.
 */
router.get("/sitemap-entries", SeoController.getSitemapEntries);

// Admin. Spans every content type, including drafts, so it is owner/admin only
// — the same guard the underlying resources' admin reads carry.
router.get(
    "/overview",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    SeoController.getSeoOverview,
);

export const SeoRoutes = router;
