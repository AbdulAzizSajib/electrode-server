import { Router } from "express";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CartController } from "./cart.controller";
import { addCartItemZodSchema, updateCartItemZodSchema } from "./cart.validation";

const router = Router();

// Every route works for both guests (guestToken cookie) and logged-in
// customers (session) on the same path — see optionalAuth + cart.service.ts.
router.use(optionalAuth);

router.get("/", CartController.getCart);
router.post("/items", validateRequest(addCartItemZodSchema), CartController.addItem);
router.patch(
    "/items/:itemId",
    validateRequest(updateCartItemZodSchema),
    CartController.updateItemQuantity,
);
router.delete("/items/:itemId", CartController.removeItem);

export const CartRoutes = router;
