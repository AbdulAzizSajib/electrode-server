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
}


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
    }
}

export const envVars = loadEnvVariables();