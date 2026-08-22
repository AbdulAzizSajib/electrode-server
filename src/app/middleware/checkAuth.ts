/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { RoleName } from "../constants/role.constant";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { prisma } from "../lib/prisma";
import { CookieUtils } from "../utils/cookie";
import { jwtUtils } from "../utils/jwt";

export const checkAuth =
    (...authRoles: RoleName[]) =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const rawSessionToken = CookieUtils.getCookie(
                req,
                "better-auth.session_token",
            );

            if (!rawSessionToken) {
                throw new AppError(
                    status.UNAUTHORIZED,
                    "Unauthorized access! No session token provided.",
                );
            }

            // Better Auth stores cookie as "{token}.{signature}" but DB has only "{token}"
            const sessionToken = rawSessionToken.includes(".")
                ? rawSessionToken.split(".")[0]
                : rawSessionToken;

            const sessionExists = await prisma.session.findFirst({
                where: {
                    token: sessionToken,
                    expiresAt: { gt: new Date() },
                },
                include: { user: { include: { role: true } } },
            });

            if (!sessionExists || !sessionExists.user) {
                throw new AppError(
                    status.UNAUTHORIZED,
                    "Unauthorized access! Invalid or expired session.",
                );
            }

            const user = sessionExists.user;

            const now = new Date();
            const expiresAt = new Date(sessionExists.expiresAt);
            const createdAt = new Date(sessionExists.createdAt);
            const sessionLifeTime = expiresAt.getTime() - createdAt.getTime();
            const timeRemaining = expiresAt.getTime() - now.getTime();
            const percentRemaining = (timeRemaining / sessionLifeTime) * 100;

            if (percentRemaining < 20) {
                res.setHeader("X-Session-Refresh", "true");
                res.setHeader("X-Session-Expires-At", expiresAt.toISOString());
                res.setHeader("X-Time-Remaining", timeRemaining.toString());
            }

            if (!user.isActive) {
                throw new AppError(
                    status.UNAUTHORIZED,
                    "Unauthorized access! User is not active.",
                );
            }

            if (user.isDeleted) {
                throw new AppError(
                    status.UNAUTHORIZED,
                    "Unauthorized access! User is deleted.",
                );
            }

            if (
                authRoles.length > 0 &&
                !authRoles.includes(user.role.name as RoleName)
            ) {
                throw new AppError(
                    status.FORBIDDEN,
                    "Forbidden access! You do not have permission to access this resource.",
                );
            }

            req.user = {
                userId: user.id,
                role: user.role.name as RoleName,
                email: user.email,
            };

            const accessToken = CookieUtils.getCookie(req, "accessToken");

            if (!accessToken) {
                throw new AppError(
                    status.UNAUTHORIZED,
                    "Unauthorized access! No access token provided.",
                );
            }

            const verifiedToken = jwtUtils.verifyToken(
                accessToken,
                envVars.ACCESS_TOKEN_SECRET,
            );

            if (!verifiedToken.success) {
                throw new AppError(
                    status.UNAUTHORIZED,
                    "Unauthorized access! Invalid access token.",
                );
            }

            if (
                authRoles.length > 0 &&
                !authRoles.includes(verifiedToken.data!.role as RoleName)
            ) {
                throw new AppError(
                    status.FORBIDDEN,
                    "Forbidden access! You do not have permission to access this resource.",
                );
            }

            next();
        } catch (error: any) {
            next(error);
        }
    };
