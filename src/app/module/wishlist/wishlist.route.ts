import { Router } from "express";
import { ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { addWishlistItemZodSchema } from "./wishlist.validation";
import { WishlistController } from "./wishlist.controller";

const router = Router();

// Auth required for every route - no guest wishlist (unlike Cart).
router.use(checkAuth(...ALL_ROLES));

router.get("/", WishlistController.getMyWishlist);
router.get("/count", WishlistController.getWishlistCount);
router.get("/contains/:productId", WishlistController.containsProduct);

router.post("/items", validateRequest(addWishlistItemZodSchema), WishlistController.addItem);
router.post("/items/:itemId/move-to-cart", WishlistController.moveItemToCart);

// MUST precede "/items/:itemId" — otherwise the literal "product" segment is
// captured as an itemId and this route is unreachable.
router.delete("/items/product/:productId", WishlistController.removeItemByProduct);
router.delete("/items/:itemId", WishlistController.removeItem);

export const WishlistRoutes = router;
