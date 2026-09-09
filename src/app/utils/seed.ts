import { RoleId, RoleName } from "../constants/role.constant";
import { envVars } from "../config/env";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { STARTER_FONT_EMBEDS } from "../module/font/font.constant";
import { parseGoogleFontEmbed } from "../module/store-setting/google-font";

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

/**
 * Populates the font library with the starter faces, but ONLY when it is empty.
 *
 * "Only when empty" rather than an upsert per row, and that distinction is the
 * whole design. `createMany({ skipDuplicates: true })` alone is idempotent in
 * the sense that it never duplicates — but it would reinstate every starter
 * font the merchant had deleted, on every single boot. A merchant who removed
 * nine of the ten faces they did not want would find them all back the next
 * morning, forever, with no way to make it stop.
 *
 * An empty table means a fresh install. A non-empty one means the merchant owns
 * the library and this must keep its hands off. That single check satisfies
 * both halves of the requirement without a "have I seeded before" marker row.
 *
 * Each embed is parsed here rather than stored pre-split, so a typo in
 * STARTER_FONT_EMBEDS fails loudly at seed time instead of writing a `url` the
 * API itself would have rejected. `skipDuplicates` is still set as a backstop
 * against two processes booting at once.
 *
 * See openspec/changes/add-font-library-and-admin-font, design.md Decision 6.
 */
export const seedFonts = async () => {
    const existing = await prisma.font.count();

    if (existing > 0) {
        return { seeded: 0, skipped: true as const };
    }

    const fonts = STARTER_FONT_EMBEDS.map((embed) => {
        const parsed = parseGoogleFontEmbed(embed);

        if (!parsed.ok) {
            throw new Error(`Starter font embed is not parseable: ${embed} — ${parsed.message}`);
        }

        return parsed.value;
    });

    const result = await prisma.font.createMany({ data: fonts, skipDuplicates: true });

    return { seeded: result.count, skipped: false as const };
};

export const seedSuperAdmin = async () => {
    try {
        await seedRoles();
        await seedStoreSettings();
        await seedFonts();

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
