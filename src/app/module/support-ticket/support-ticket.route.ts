import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { SupportTicketController } from "./support-ticket.controller";
import {
    createSupportMessageZodSchema,
    createSupportTicketZodSchema,
    updateSupportTicketZodSchema,
} from "./support-ticket.validation";

const router = Router();
router.use(checkAuth(...ALL_ROLES));

router.post("/", validateRequest(createSupportTicketZodSchema), SupportTicketController.createTicket);
router.get("/", SupportTicketController.getTickets);
router.get("/:id", SupportTicketController.getTicketById);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(updateSupportTicketZodSchema),
    SupportTicketController.updateTicket,
);

export const SupportTicketRoutes = router;

// Mounted at /support-tickets/:id/messages — req.params.id inherited from the parent mount path.
const messagesRouter = Router({ mergeParams: true });
messagesRouter.use(checkAuth(...ALL_ROLES));
messagesRouter.post(
    "/",
    validateRequest(createSupportMessageZodSchema),
    SupportTicketController.createMessage,
);
messagesRouter.get("/", SupportTicketController.getMessages);

export const SupportMessageRoutes = messagesRouter;
