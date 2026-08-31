import { UserStatus } from "../../../generated/prisma/client";

export interface IUpdateUserPayload {
    name?: string;
    contactNumber?: string;
    image?: string;
    isActive?: boolean;
    status?: UserStatus;
    /**
     * OWNER-only. Enforced in the service against the requester's role rather
     * than at the route, because the rest of this payload is legitimately
     * OWNER/ADMIN — see UserService.updateUser.
     */
    roleId?: string;
}

export interface IUpdateOwnProfilePayload {
    name?: string;
    contactNumber?: string;
    image?: string;
}
