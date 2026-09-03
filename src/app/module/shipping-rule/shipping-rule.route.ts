import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ShippingRuleController } from "./shipping-rule.controller";
import {
    createShippingRuleZodSchema,
    updateShippingRuleZodSchema,
} from "./shipping-rule.validation";

const router = Router();

/*
 * Admin-only. Like tax rules, these are commercial policy: a shopper is quoted
 * a delivery price at checkout and never needs the rule behind it.
 */
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

// Above `/:id`, or the literal segment would be captured as an id.
router.get("/all", ShippingRuleController.getAllShippingRules);

router.get("/", ShippingRuleController.getShippingRules);
router.get("/:id", ShippingRuleController.getShippingRuleById);

router.post(
    "/",
    validateRequest(createShippingRuleZodSchema),
    ShippingRuleController.createShippingRule,
);
router.patch(
    "/:id",
    validateRequest(updateShippingRuleZodSchema),
    ShippingRuleController.updateShippingRule,
);
router.delete("/:id", ShippingRuleController.deleteShippingRule);

export const ShippingRuleRoutes = router;
