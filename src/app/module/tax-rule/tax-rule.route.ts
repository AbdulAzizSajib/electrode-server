import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { TaxRuleController } from "./tax-rule.controller";
import { createTaxRuleZodSchema, updateTaxRuleZodSchema } from "./tax-rule.validation";

const router = Router();

/*
 * Admin-only. Tax rules are commercial policy: a shopper is told what tax cost
 * at checkout, where it is computed, and never needs the rule itself.
 */
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

// Above `/:id`, or the literal segment would be captured as an id.
router.get("/all", TaxRuleController.getAllTaxRules);

router.get("/", TaxRuleController.getTaxRules);
router.get("/:id", TaxRuleController.getTaxRuleById);

router.post("/", validateRequest(createTaxRuleZodSchema), TaxRuleController.createTaxRule);
router.patch("/:id", validateRequest(updateTaxRuleZodSchema), TaxRuleController.updateTaxRule);
router.delete("/:id", TaxRuleController.deleteTaxRule);

export const TaxRuleRoutes = router;
