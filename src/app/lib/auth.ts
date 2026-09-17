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
            // The parameter type is deliberately left to be inferred from
            // better-auth's own signature rather than spelled out here, so it
            // cannot go stale against the library and break `tsc` (so `npm run
            // build`). As of better-auth 1.4.18 the plugin emits exactly
            // "sign-in" | "email-verification" | "forget-password"; changing
            // an existing address is NOT one of them - that flow is the
            // `user.changeEmail.sendChangeEmailVerification` option instead,
            // which this app does not enable.
            async sendVerificationOTP({ email, otp, type }) {
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

   
    /*
     * Must include the admin panel's deployed origin for the same reason the
     * CORS allowlist in app.ts does: it is a third deployment, separate from the
     * storefront (FRONTEND_URL) and this server (BETTER_AUTH_URL). Left out,
     * better-auth rejects the panel's sign-in requests even though CORS lets
     * them through — two separate allowlists that have to agree.
     */
    trustedOrigins: [
        envVars.BETTER_AUTH_URL,
        "http://localhost:5000",
        "http://localhost:5173",
        "http://localhost:3000",
        envVars.FRONTEND_URL,
        envVars.ADMIN_URL,
    ].filter(Boolean) as string[],

    advanced: {
        useSecureCookies: envVars.NODE_ENV === "production",
        cookies: {
            /*
             * `lax`, NOT `none` — and deliberately not the same as sessionToken
             * below.
             *
             * The OAuth state cookie is set by this server and comes back to
             * this server: the whole handshake is
             *   BETTER_AUTH_URL/auth/login/google
             *     -> accounts.google.com
             *     -> BETTER_AUTH_URL/api/auth/callback/google
             * so the cookie is same-site with its own callback, and every hop
             * is a top-level navigation — exactly what `lax` permits.
             *
             * It was `none` in production, which is what caused
             * `state_mismatch` on Vercel while localhost (where NODE_ENV is not
             * "production", so this resolved to `lax`) worked fine. `none`
             * marks the cookie as third-party, and Chrome/Brave block or
             * partition third-party cookies by default, so the state cookie set
             * on the way out to Google was gone on the way back. better-auth
             * then had nothing to compare the returned `state` against and
             * failed the request before any of our controller code ran.
             *
             * Do not "align" this with sessionToken. That one is `none`
             * because it really is read cross-site — the storefront is a
             * separate origin. This one never is, and `none` only exposes it
             * to the browser's third-party cookie rules for no benefit.
             */
            state: {
                attributes: {
                    sameSite: "lax",
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
