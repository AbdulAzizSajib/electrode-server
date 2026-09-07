import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AttributeController } from "./attribute.controller";
import {
    createAttributeValueZodSchema,
    createAttributeZodSchema,
    updateAttributeValueZodSchema,
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

/*
 * One value at a time, for callers that hold a product rather than an
 * attribute.
 *
 * `PATCH /:id` reconciles against the whole `values` array and deletes what the
 * payload omits, which is right for the Attributes page — it authors the list —
 * and wrong for anywhere else: a product form that sends "Black, White, Navy"
 * built from a list fetched a minute ago silently deletes the colour someone
 * added meanwhile. These touch exactly the value named in the path.
 */
router.post(
    "/:id/values",
    validateRequest(createAttributeValueZodSchema),
    AttributeController.createAttributeValue,
);
router.patch(
    "/:id/values/:valueId",
    validateRequest(updateAttributeValueZodSchema),
    AttributeController.updateAttributeValue,
);
router.delete("/:id/values/:valueId", AttributeController.deleteAttributeValue);

export const AttributeRoutes = router;
