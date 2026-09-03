import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AttributeController } from "./attribute.controller";
import {
    createAttributeZodSchema,
    updateAttributeZodSchema,
} from "./attribute.validation";

const router = Router();

/*
 * Admin-only throughout. Attributes are authoring data: a shopper meets them
 * through a product's options, never as a catalogue of their own, so there is
 * no public read here.
 */
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

// Above `/:id`, or the literal segment would be captured as an id.
router.get("/all", AttributeController.getAllAttributes);

router.get("/", AttributeController.getAttributes);
router.get("/:id", AttributeController.getAttributeById);

router.post("/", validateRequest(createAttributeZodSchema), AttributeController.createAttribute);
router.patch("/:id", validateRequest(updateAttributeZodSchema), AttributeController.updateAttribute);
router.delete("/:id", AttributeController.deleteAttribute);

export const AttributeRoutes = router;
