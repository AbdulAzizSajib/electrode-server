import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CampaignController } from "./campaign.controller";
import { createCampaignZodSchema, updateCampaignZodSchema } from "./campaign.validation";

// Admin-only — no separate customer-facing endpoint; the discount surfaces
// automatically in Phase 1's public product endpoints once a campaign is ACTIVE.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

router.post("/", validateRequest(createCampaignZodSchema), CampaignController.createCampaign);
router.get("/", CampaignController.getAdminCampaigns);
router.get("/:id", CampaignController.getCampaignById);
router.patch("/:id", validateRequest(updateCampaignZodSchema), CampaignController.updateCampaign);
router.delete("/:id", CampaignController.deleteCampaign);

export const CampaignRoutes = router;
