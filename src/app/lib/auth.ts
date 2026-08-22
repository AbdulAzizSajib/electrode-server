import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, emailOTP } from "better-auth/plugins";
import { RoleName } from "../constants/role.constant";
import { envVars } from "../config/env";
import { sendEmail } from "../utils/email";
import { prisma } from "./prisma";

const ONE_DAY_SECONDS = 60 * 60 * 24;

export const auth = betterAuth({
    baseURL: envVars.BETTER_AUTH_URL,
    secret: envVars.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),

    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
    },

    socialProviders: {
        google: {
            clientId: envVars.GOOGLE_CLIENT_ID,
            clientSecret: envVars.GOOGLE_CLIENT_SECRET,
            mapProfileToUser: () => {
                // roleId is intentionally omitted here - Google sign-ups are
                // public storefront users, so they get the schema's default
                // role (CUSTOMER, see prisma/schema/auth.prisma) rather than
                // any elevated role.
                return {
                    isActive: true,
                    needPasswordChange: false,
                    emailVerified: true,
                    isDeleted: false,
                    deletedAt: null,
                };
            },
        },
    },

    emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
    },

    user: {
        additionalFields: {
            // `role`/`roleId` is deliberately NOT declared as an
            // additionalField: `User.role` is now a Prisma relation
            // (roleId -> Role), not a flat scalar better-auth can manage.
            // Rows created through better-auth (email/password, Google)
            // fall back to the schema-level default (CUSTOMER) on the
            // roleId column; elevated roles are assigned explicitly via
            // direct Prisma updates (see seed.ts, user.service.ts).
            contactNumber: {
                type: "string",
                required: false,
            },
            isActive: {
                type: "boolean",
                required: false,
                defaultValue: true,
                input: false,
            },
            needPasswordChange: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false,
            },
            isDeleted: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false,
            },
            deletedAt: {
                type: "date",
                required: false,
                input: false,
            },
            lastLoginAt: {
                type: "date",
                required: false,
                input: false,
            },
        },
    },

    plugins: [
        bearer(),
        emailOTP({
            overrideDefaultEmailVerification: true,
            async sendVerificationOTP({
                email,
                otp,
                type,
            }: {
                email: string;
                otp: string;
                type: "email-verification" | "forget-password" | "sign-in";
            }) {
                if (type === "email-verification") {
                    const user = await prisma.user.findUnique({
                        where: { email },
                        include: { role: true },
                    });

                    if (!user) {
                        console.error(`User with email ${email} not found. Cannot send verification OTP.`);
                        return;
                    }

                    if (user.role.name === RoleName.OWNER) {
                        console.log(`User ${email} is the owner. Skipping verification OTP.`);
                        return;
                    }

                    if (!user.emailVerified) {
                        sendEmail({
                            to: email,
                            subject: "Verify your email",
                            templateName: "otp",
                            templateData: { name: user.name, otp },
                        });
                    }
                } else if (type === "forget-password") {
                    const user = await prisma.user.findUnique({
                        where: { email },
                    });

                    if (user) {
                        sendEmail({
                            to: email,
                            subject: "Password Reset OTP",
                            templateName: "otp",
                            templateData: { name: user.name, otp },
                        });
                    }
                }
            },
            expiresIn: 5 * 60,
            otpLength: 4,
        }),
    ],

    session: {
        expiresIn: ONE_DAY_SECONDS * 7,
        updateAge: ONE_DAY_SECONDS,
        cookieCache: {
            enabled: true,
            maxAge: 5 * 60,
        },
    },

    redirectURLs: {
        signIn: `${envVars.BETTER_AUTH_URL}/api/v1/auth/google/success`,
    },

   
    trustedOrigins: [
        envVars.BETTER_AUTH_URL,
        "http://localhost:5000",
        "http://localhost:5173",
        "http://localhost:3000",
        envVars.FRONTEND_URL,
    ].filter(Boolean) as string[],

    advanced: {
        useSecureCookies: envVars.NODE_ENV === "production",
        cookies: {
            state: {
                attributes: {
                    sameSite: envVars.NODE_ENV === "production" ? "none" : "lax",
                    secure: envVars.NODE_ENV === "production",
                    httpOnly: true,
                    path: "/",
                },
            },
            sessionToken: {
                attributes: {
                    sameSite: envVars.NODE_ENV === "production" ? "none" : "lax",
                    secure: envVars.NODE_ENV === "production",
                    httpOnly: true,
                    path: "/",
                },
            },
        },
    },
});
