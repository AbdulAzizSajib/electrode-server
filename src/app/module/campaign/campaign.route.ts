import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CampaignController } from "./campaign.controller";
import { createCampaignZodSchema, updateCampaignZodSchema } from "./campaign.validation";

const router = Router();

// Public — MUST stay above the `router.use(checkAuth(...))` below, which is a
// blanket guard applied in declaration order: every route declared after it is
// admin-only by construction, so appending this one would silently 401 it.
//
// Also declared above "/:id": Express matches in declaration order, so a later
// declaration would let the parameterised route capture the literal path
// "active" and 404 as though a campaign with that id were missing — the same
// hazard documented in product.route.ts.
//
// Product *discounts* still surface automatically on the public product
// endpoints; this route exists because a storefront cannot ask those endpoints
// which campaign is running or when it ends, which is what a countdown needs.
router.get("/active", CampaignController.getActiveCampaign);

// Everything below is admin-only.
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

router.post("/", validateRequest(createCampaignZodSchema), CampaignController.createCampaign);
router.get("/", CampaignController.getAdminCampaigns);
router.get("/:id", CampaignController.getCampaignById);
router.patch("/:id", validateRequest(updateCampaignZodSchema), CampaignController.updateCampaign);
router.delete("/:id", CampaignController.deleteCampaign);

export const CampaignRoutes = router;
