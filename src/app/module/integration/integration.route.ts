/**
 * Integration routes — OWNER and ADMIN only, all of them.
 *
 * THERE IS NO PUBLIC ROUTE IN THIS FILE, and there must not be one. Everything
 * this module reads sits next to encrypted credentials, and the public half of
 * integration configuration (the Meta pixel id) is deliberately served by
 * `GET /settings/public` instead, from `StoreSetting.integrationConfig`. Keeping
 * the two apart at the ROUTE level is what stops a future "the storefront needs
 * one field from here" from quietly widening access to the rest.
 *
 * STAFF is excluded on purpose, unlike most admin surfaces. A staff member
 * dispatches parcels; changing which account they are dispatched through, or
 * what the shop's ad measurement reports, is an owner-level decision.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decision 5.
 */
import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { IntegrationController } from "./integration.controller";
import {
    generateWebhookZodSchema,
    updateCredentialsZodSchema,
    updateIntegrationZodSchema,
} from "./integration.validation";

const router = Router();

router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), IntegrationController.listIntegrations);

router.get(
    "/:provider",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    IntegrationController.getIntegration,
);

/*
 * Credentials and the webhook secret are separate endpoints because they are
 * separate actions with different consequences: saving a key is idempotent and
 * reversible, while generating a webhook secret invalidates the previous one
 * immediately and drops notifications until the courier's panel is updated.
 * Collapsing them into one PUT would make that destructive step a side effect of
 * an innocuous one.
 */
router.put(
    "/:provider/credentials",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateCredentialsZodSchema),
    IntegrationController.updateCredentials,
);

router.put(
    "/:provider/webhook",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(generateWebhookZodSchema),
    IntegrationController.generateWebhookSecret,
);

router.patch(
    "/:provider",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateIntegrationZodSchema),
    IntegrationController.setEnabled,
);

export const IntegrationRoutes = router;
