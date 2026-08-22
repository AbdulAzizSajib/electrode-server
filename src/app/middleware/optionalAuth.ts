import { NextFunction, Request, Response } from "express";
import { envVars } from "../config/env";
import { RoleName } from "../constants/role.constant";
import { prisma } from "../lib/prisma";
import { CookieUtils } from "../utils/cookie";
import { jwtUtils } from "../utils/jwt";

/**
 * Cart routes must work identically for guests and logged-in customers on
 * the same path (per `api/cart-wishlist` spec: "a cart operation without
 * [a session] SHALL fall back to guest-cart behavior instead of failing").
 * This mirrors checkAuth's session/access-token resolution but never
 * throws or blocks the request — on any missing/invalid/expired credential
 * it just calls next() without setting req.user, leaving the request to be
 * treated as a guest by the route handler.
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const rawSessionToken = CookieUtils.getCookie(req, "better-auth.session_token");
        if (!rawSessionToken) return next();

        const sessionToken = rawSessionToken.includes(".")
            ? rawSessionToken.split(".")[0]
            : rawSessionToken;

        const sessionExists = await prisma.session.findFirst({
            where: { token: sessionToken, expiresAt: { gt: new Date() } },
            include: { user: { include: { role: true } } },
        });

        const user = sessionExists?.user;
        if (!user || !user.isActive || user.isDeleted) {
            return next();
        }

        const accessToken = CookieUtils.getCookie(req, "accessToken");
        if (!accessToken) return next();

        const verifiedToken = jwtUtils.verifyToken(accessToken, envVars.ACCESS_TOKEN_SECRET);
        if (!verifiedToken.success) return next();

        req.user = {
            userId: user.id,
            role: user.role.name as RoleName,
            email: user.email,
        };

        next();
    } catch {
        // Any unexpected failure degrades to "treat as guest" rather than blocking the request.
        next();
    }
};
