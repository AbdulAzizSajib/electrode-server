import dotenv from 'dotenv';
import status from 'http-status';
import AppError from '../errorHelpers/AppError';

dotenv.config();

interface EnvConfig {
    NODE_ENV: string;
    PORT: string;
    DATABASE_URL: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    ACCESS_TOKEN_SECRET: string;
    REFRESH_TOKEN_SECRET: string;
    ACCESS_TOKEN_EXPIRES_IN: string;
    REFRESH_TOKEN_EXPIRES_IN: string;
    EMAIL_SENDER:{
        SMTP_USER: string;
        SMTP_PASS: string;
        SMTP_HOST: string;
        SMTP_PORT: string;
        SMTP_FROM: string;
    }
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_CALLBACK_URL: string;
    FRONTEND_URL: string;
    CLOUDINARY:{
        CLOUDINARY_CLOUD_NAME: string;
        CLOUDINARY_API_KEY: string;
        CLOUDINARY_API_SECRET: string;
    },
    SUPER_ADMIN_EMAIL: string;
    SUPER_ADMIN_PASSWORD: string;
    SUBSCRIPTION_BKASH_NUMBER: string;
    /**
     * Shared secret for the storefront's /api/revalidate endpoint, so a
     * settings save clears the storefront's cached copy immediately instead of
     * waiting out its revalidate window.
     *
     * Optional, and deliberately absent from requireEnvVariable below: an
     * install without it keeps working, it just falls back to the storefront's
     * own timing. The secret lives here rather than in the admin panel because
     * the admin is a browser bundle and could not keep it.
     */
    STOREFRONT_REVALIDATE_SECRET?: string;
    /**
     * The storefront's origin, for the revalidation ping above. Optional —
     * FRONTEND_URL is used when this is unset. They are usually the same, but
     * FRONTEND_URL also backs auth callbacks and email links, so this exists
     * for a deployment where the storefront answers on a different host or
     * port and repointing FRONTEND_URL would break those.
     */
    STOREFRONT_URL?: string;
    /**
     * IANA timezone the admin reports resolve a date range in, so "1–31 March"
     * means the same 31 days whichever machine asks for it (design decision
     * 14). Optional; `Asia/Dhaka` when unset, which is where this store trades.
     *
     * Not a StoreSetting column: making it merchant-editable is its own change
     * (see design.md — Open Questions), and a report cannot wait for it.
     */
    STORE_TIMEZONE?: string;
    /**
     * Steadfast Courier API credentials.
     *
     * In the environment and NOT in StoreSetting, deliberately. `GET /settings`
     * is public — the storefront renders its payload into every page — so a
     * credential stored on that row is one careless field selection away from
     * being served to the internet. Cloudinary's keys sit here for the same
     * reason. The cost is that rotating a key is a redeploy rather than a form,
     * which is the right trade for a secret that lets a stranger create
     * consignments billed to the merchant.
     *
     * Optional, and absent from requireEnvVariable below: an install without
     * them boots normally and the courier endpoints report themselves
     * unconfigured. Manual shipment entry is unaffected.
     * See openspec/changes/add-steadfast-courier-integration, design.md Decision 1.
     */
    STEADFAST_API_KEY?: string;
    STEADFAST_SECRET_KEY?: string;
    /** Overridable for a sandbox account; the live API when unset. */
    STEADFAST_BASE_URL?: string;
    /**
     * Shared secret for POST /courier/sync, which Vercel Cron calls on a
     * schedule. Same posture as STOREFRONT_REVALIDATE_SECRET above: a header the
     * caller must present, an endpoint that refuses without it.
     *
     * `node-cron` cannot drive this — the server runs as a Vercel function and
     * no process survives between requests (design.md Decision 7).
     */
    COURIER_SYNC_SECRET?: string;
    /**
     * Bearer token Steadfast presents when calling POST /courier/webhook.
     *
     * WE generate this and paste it into their portal's Webhook Integration
     * form; it is not issued by them. It is the entire authentication boundary
     * on that endpoint, which necessarily sits outside `checkAuth` because
     * Steadfast has no session here.
     *
     * Unset means the webhook endpoint refuses every call — deliberately, since
     * accepting unauthenticated status updates is worse than accepting none.
     * Dispatch and the reconciliation job are unaffected.
     */
    STEADFAST_WEBHOOK_TOKEN?: string;
    /**
     * Origin of the deployed admin panel, for CORS and better-auth's trusted
     * origins.
     *
     * A THIRD origin, distinct from the two that already exist: `FRONTEND_URL`
     * is the storefront and `BETTER_AUTH_URL` is this server. The admin panel is
     * a separate deployment, and without it here every one of its requests is
     * refused by CORS preflight — which presents as "the panel loads but nothing
     * works", not as a configuration error.
     *
     * Optional: local development is already covered by the explicit localhost
     * entries in the allowlist.
     */
    ADMIN_URL?: string;
}

/** The live Steadfast API, used when STEADFAST_BASE_URL is unset. */
export const STEADFAST_DEFAULT_BASE_URL = "https://portal.packzy.com/api/v1";


const loadEnvVariables = (): EnvConfig => {

    const requireEnvVariable = [
        'NODE_ENV',
        'PORT',
        'DATABASE_URL',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'ACCESS_TOKEN_SECRET',
        'REFRESH_TOKEN_SECRET',
        'ACCESS_TOKEN_EXPIRES_IN',
        'REFRESH_TOKEN_EXPIRES_IN',
        'EMAIL_SENDER_SMTP_USER',
        'EMAIL_SENDER_SMTP_PASS',
        'EMAIL_SENDER_SMTP_HOST',
        'EMAIL_SENDER_SMTP_PORT',
        'EMAIL_SENDER_SMTP_FROM',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_CALLBACK_URL',
        'FRONTEND_URL',
        'CLOUDINARY_CLOUD_NAME',
        'CLOUDINARY_API_KEY',
        'CLOUDINARY_API_SECRET',
        'SUPER_ADMIN_EMAIL',
        'SUPER_ADMIN_PASSWORD',
        'SUBSCRIPTION_BKASH_NUMBER'
    ]

    requireEnvVariable.forEach((variable) => {
        if (!process.env[variable]) {
            // throw new Error(`Environment variable ${variable} is required but not set in .env file.`);
            throw new AppError(status.INTERNAL_SERVER_ERROR, `Environment variable ${variable} is required but not set in .env file.`);
        }
    })

    return {
        NODE_ENV: process.env.NODE_ENV as string,
        PORT: process.env.PORT as string,
        DATABASE_URL: process.env.DATABASE_URL as string,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET as string,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL as string,
        ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET as string,
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET as string,
        ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN as string,
        REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN as string,
        EMAIL_SENDER: {
            SMTP_USER: process.env.EMAIL_SENDER_SMTP_USER as string,
            SMTP_PASS: process.env.EMAIL_SENDER_SMTP_PASS as string,
            SMTP_HOST: process.env.EMAIL_SENDER_SMTP_HOST as string,
            SMTP_PORT: process.env.EMAIL_SENDER_SMTP_PORT as string,
            SMTP_FROM: process.env.EMAIL_SENDER_SMTP_FROM as string,
        },
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET as string,
        GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL as string,
        FRONTEND_URL: process.env.FRONTEND_URL as string,
        CLOUDINARY: {
            CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME as string,
            CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY as string,
            CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET as string,
        },
        SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL as string,
        SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD as string,
        SUBSCRIPTION_BKASH_NUMBER: process.env.SUBSCRIPTION_BKASH_NUMBER as string,
        STOREFRONT_REVALIDATE_SECRET: process.env.STOREFRONT_REVALIDATE_SECRET,
        STOREFRONT_URL: process.env.STOREFRONT_URL,
        STORE_TIMEZONE: process.env.STORE_TIMEZONE,
        STEADFAST_API_KEY: process.env.STEADFAST_API_KEY,
        STEADFAST_SECRET_KEY: process.env.STEADFAST_SECRET_KEY,
        STEADFAST_BASE_URL: process.env.STEADFAST_BASE_URL,
        COURIER_SYNC_SECRET: process.env.COURIER_SYNC_SECRET,
        STEADFAST_WEBHOOK_TOKEN: process.env.STEADFAST_WEBHOOK_TOKEN,
        ADMIN_URL: process.env.ADMIN_URL,
    }
}

export const envVars = loadEnvVariables();