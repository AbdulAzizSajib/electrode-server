import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { StockController } from "./stock.controller";
import { adjustStockZodSchema } from "./stock.validation";

// Admin/staff-only — inventory endpoints are never reachable by a customer or unauthenticated request.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF));

router.get("/", StockController.getStock);
router.patch("/:id/adjust", validateRequest(adjustStockZodSchema), StockController.adjustStock);

export const StockRoutes = router;

// Mounted separately at /stock-movements
const movementsRouter = Router();
movementsRouter.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF));
movementsRouter.get("/", StockController.getStockMovements);

export const StockMovementRoutes = movementsRouter;
