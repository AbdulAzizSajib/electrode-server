import { RoleId, RoleName } from "../constants/role.constant";
import { envVars } from "../config/env";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";

/**
 * Ensures the RBAC `Role` rows this platform relies on exist. `User.roleId`
 * defaults to `RoleId.CUSTOMER` at the schema level (see
 * prisma/schema/auth.prisma), so that row in particular must exist before
 * any user (self-registered or seeded) can be created.
 */
const seedRoles = async () => {
    const roles = [
        { id: RoleId.OWNER, name: RoleName.OWNER, description: "Full access to the store and admin panel" },
        { id: RoleId.ADMIN, name: RoleName.ADMIN, description: "Manages catalog, orders, and staff" },
        { id: RoleId.STAFF, name: RoleName.STAFF, description: "Limited admin-panel access for day-to-day operations" },
        { id: RoleId.CUSTOMER, name: RoleName.CUSTOMER, description: "Storefront shopper (default role for public sign-ups)" },
    ];

    for (const role of roles) {
        await prisma.role.upsert({
            where: { id: role.id },
            update: { name: role.name, description: role.description },
            create: role,
        });
    }
};

/**
 * Ensures the singleton `StoreSetting` row exists (id "singleton"). Safe
 * to call repeatedly - only creates the row if missing, never overwrites
 * settings an admin has already changed.
 */
const seedStoreSettings = async () => {
    await prisma.storeSetting.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
    });
};

export const seedSuperAdmin = async () => {
    try {
        await seedRoles();
        await seedStoreSettings();

        if (!envVars.SUPER_ADMIN_EMAIL || !envVars.SUPER_ADMIN_PASSWORD) {
            console.log(
                "SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD not set. Skipping super admin seeding.",
            );
            return;
        }

        const isSuperAdminExist = await prisma.user.findFirst({
            where: { roleId: RoleId.OWNER },
        });

        if (isSuperAdminExist) {
            console.log("Super admin already exists. Skipping.");
            return;
        }

        const superAdminUser = await auth.api.signUpEmail({
            body: {
                email: envVars.SUPER_ADMIN_EMAIL,
                password: envVars.SUPER_ADMIN_PASSWORD,
                name: "Super Admin",
                rememberMe: false,
            },
        });

        // better-auth creates the row with the schema default role
        // (CUSTOMER); promote it to OWNER explicitly here.
        const superAdmin = await prisma.user.update({
            where: { id: superAdminUser.user.id },
            data: {
                emailVerified: true,
                roleId: RoleId.OWNER,
                isActive: true,
            },
        });

        console.log("Super Admin Created:", superAdmin.email);
    } catch (error) {
        console.error("Error seeding super admin:", error);
    }
};
