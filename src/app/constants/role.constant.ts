/**
 * Canonical role names for this platform's RBAC system (owner/admin/staff
 * for the admin panel, customer for storefront users).
 *
 * These are intentionally NOT imported from `generated/prisma` — `Role` is
 * a database-backed model (see `prisma/schema/role.prisma`), not a Prisma
 * enum, so there is no generated enum to import. `RoleName` mirrors the
 * `name` column of the seeded `Role` rows; `RoleId` mirrors their fixed
 * primary keys. Both are seeded in `src/app/utils/seed.ts`.
 */
export const RoleName = {
    OWNER: "OWNER",
    ADMIN: "ADMIN",
    STAFF: "STAFF",
    CUSTOMER: "CUSTOMER",
} as const;

export type RoleName = (typeof RoleName)[keyof typeof RoleName];

/** Fixed primary keys for the seeded Role rows (see seed.ts). */
export const RoleId = {
    OWNER: "owner",
    ADMIN: "admin",
    STAFF: "staff",
    CUSTOMER: "customer",
} as const;

/** All role names that may access admin-panel-only routes. */
export const ADMIN_PANEL_ROLES: RoleName[] = [
    RoleName.OWNER,
    RoleName.ADMIN,
    RoleName.STAFF,
];

/** Every role name, for routes any authenticated user may reach. */
export const ALL_ROLES: RoleName[] = [
    RoleName.OWNER,
    RoleName.ADMIN,
    RoleName.STAFF,
    RoleName.CUSTOMER,
];
