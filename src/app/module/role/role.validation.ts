import z from "zod";

export const createRoleZodSchema = z.object({
    name: z.string().min(2).max(50),
    description: z.string().max(500).optional(),
});

export const updateRoleZodSchema = z.object({
    name: z.string().min(2).max(50).optional(),
    description: z.string().max(500).optional(),
});

export const createPermissionZodSchema = z.object({
    name: z.string().min(2).max(100),
    description: z.string().max(500).optional(),
});

export const updatePermissionZodSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(500).optional(),
});

export const assignPermissionZodSchema = z.object({
    permissionId: z.string(),
});
