import z from "zod";

export const registerUserZodSchema = z.object({
    name: z
        .string("Name is required and must be string")
        .min(3, "Name must be at least 3 characters")
        .max(50, "Name must be at most 50 characters"),
    email: z.email("Invalid email address"),
    password: z
        .string("Password is required")
        .min(6, "Password must be at least 6 characters")
        .max(50, "Password must be at most 50 characters"),
    contactNumber: z
        .string()
        .min(11, "Contact number must be at least 11 characters")
        .max(15, "Contact number must be at most 15 characters")
        .optional(),
});

export const loginUserZodSchema = z.object({
    email: z.email("Invalid email address"),
    password: z.string("Password is required").min(1, "Password is required"),
});

export const changePasswordZodSchema = z.object({
    currentPassword: z.string("Current password is required").min(1),
    newPassword: z
        .string("New password is required")
        .min(6, "Password must be at least 6 characters")
        .max(50, "Password must be at most 50 characters"),
});

export const verifyEmailZodSchema = z.object({
    email: z.email("Invalid email address"),
    otp: z
        .string("OTP is required")
        .length(4, "OTP must be exactly 4 digits"),
});

export const forgetPasswordZodSchema = z.object({
    email: z.email("Invalid email address"),
});

export const resendOtpZodSchema = z.object({
    email: z.email("Invalid email address"),
});

export const resetPasswordZodSchema = z.object({
    email: z.email("Invalid email address"),
    otp: z.string("OTP is required").length(4, "OTP must be exactly 4   digits"),
    newPassword: z
        .string("New password is required")
        .min(6, "Password must be at least 6 characters")
        .max(50, "Password must be at most 50 characters"),
});
