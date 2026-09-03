import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { TagController } from "./tag.controller";

const router = Router();

/*
 * Admin-only. Tags reach a shopper through a product, never as a catalogue of
 * their own.
 *
 * There is no create endpoint: tags come into existence by being typed on a
 * product, which is `TagService.syncProductTags`. A tag nothing is tagged with
 * would be a keyword for nothing.
 */
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

// Above `/:id`, or the literal segment would be captured as an id.
router.get("/search", TagController.searchTags);

router.get("/", TagController.getTags);
router.delete("/:id", TagController.deleteTag);

export const TagRoutes = router;
