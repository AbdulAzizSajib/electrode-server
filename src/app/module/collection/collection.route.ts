import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CollectionController } from "./collection.controller";
import {
    createCollectionZodSchema,
    updateCollectionZodSchema,
} from "./collection.validation";

const router = Router();

router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

// Above `/:id`, or the literal segment would be captured as an id.
router.get("/all", CollectionController.getAllCollections);

router.get("/", CollectionController.getCollections);
router.get("/:id", CollectionController.getCollectionById);

router.post("/", validateRequest(createCollectionZodSchema), CollectionController.createCollection);
router.patch(
    "/:id",
    validateRequest(updateCollectionZodSchema),
    CollectionController.updateCollection,
);
router.delete("/:id", CollectionController.deleteCollection);

export const CollectionRoutes = router;
