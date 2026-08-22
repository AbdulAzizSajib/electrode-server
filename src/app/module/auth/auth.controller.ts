import { Request, Response } from "express";
import status from "http-status";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import { auth } from "../../lib/auth";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CookieUtils } from "../../utils/cookie";
import { tokenUtils } from "../../utils/token";
import { CartService } from "../cart/cart.service";
import { CustomerService } from "../customer/customer.service";
import { UserService } from "../user/user.service";
import { AuthService } from "./auth.service";

const GUEST_TOKEN_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
};

/**
 * Merges a guest cart into the now-authenticated customer's cart, per
 * `api/cart-wishlist` spec ("Login with an active guest cart"). Called from
 * every endpoint that hands the browser a fresh session (login, email
 * verification completing registration, OAuth login) — a no-op if the
 * request carries no guestToken cookie.
 */
const mergeGuestCartIfPresent = async (req: Request, res: Response, userId: string) => {
    const guestToken = CookieUtils.getCookie(req, "guestToken");
    if (!guestToken) {
        return;
    }

    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    await CartService.mergeGuestCartIntoCustomerCart(customer.id, guestToken);

    CookieUtils.clearCookie(res, "guestToken", GUEST_TOKEN_COOKIE_OPTIONS);
};

const registerUser = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.registerUser(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message:
            "User registered successfully. Please verify your email with the OTP sent to you.",
        data: result,
    });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.loginUser(req.body);
    const { accessToken, refreshToken, token, ...rest } = result;

    tokenUtils.setAccessTokenCookie(res, accessToken);
    tokenUtils.setRefreshTokenCookie(res, refreshToken);
    tokenUtils.setBetterAuthSessionCookie(res, token);

    await mergeGuestCartIfPresent(req, res, result.user.id);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User logged in successfully",
        data: { token, accessToken, refreshToken, ...rest },
    });
});

const getMe = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.getMe(req.user);
    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User profile fetched successfully",
        data: result,
    });
});

const updateOwnProfile = catchAsync(async (req: Request, res: Response) => {
    const payload = { ...req.body };

    if (req.file) {
        const uploadResult = await uploadFileToCloudinary(
            req.file.buffer,
            req.file.originalname,
        );
        payload.image = uploadResult.secure_url;
    }

    const result = await UserService.updateOwnProfile(
        req.user.userId,
        payload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Profile updated successfully",
        data: result,
    });
});

const getNewToken = catchAsync(async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken;
    const betterAuthSessionToken = req.cookies["better-auth.session_token"];

    if (!refreshToken) {
        throw new AppError(status.UNAUTHORIZED, "Refresh token is missing");
    }

    const result = await AuthService.getNewToken(
        refreshToken,
        betterAuthSessionToken,
    );

    const { accessToken, refreshToken: newRefreshToken, sessionToken } = result;

    tokenUtils.setAccessTokenCookie(res, accessToken);
    tokenUtils.setRefreshTokenCookie(res, newRefreshToken);
    tokenUtils.setBetterAuthSessionCookie(res, sessionToken);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "New tokens generated successfully",
        data: { accessToken, refreshToken: newRefreshToken, sessionToken },
    });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
    const betterAuthSessionToken = req.cookies["better-auth.session_token"];
    const result = await AuthService.changePassword(
        req.body,
        betterAuthSessionToken,
    );

    const { accessToken, refreshToken, token } = result;

    tokenUtils.setAccessTokenCookie(res, accessToken);
    tokenUtils.setRefreshTokenCookie(res, refreshToken);
    if (token) tokenUtils.setBetterAuthSessionCookie(res, token as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Password changed successfully",
        data: result,
    });
});

const logoutUser = catchAsync(async (req: Request, res: Response) => {
    const betterAuthSessionToken = req.cookies["better-auth.session_token"];
    const result = await AuthService.logoutUser(betterAuthSessionToken);

    const cookieOptions = {
        httpOnly: true,
        secure: envVars.NODE_ENV === "production",
        sameSite: envVars.NODE_ENV === "production" ? ("none" as const) : ("lax" as const),
    };

    CookieUtils.clearCookie(res, "accessToken", cookieOptions);
    CookieUtils.clearCookie(res, "refreshToken", cookieOptions);
    CookieUtils.clearCookie(res, "better-auth.session_token", cookieOptions);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User logged out successfully",
        data: result,
    });
});

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
    const { email, otp } = req.body;
    const result = await AuthService.verifyEmail(email, otp);

    const { accessToken, refreshToken, token, ...rest } = result;

    tokenUtils.setAccessTokenCookie(res, accessToken);
    tokenUtils.setRefreshTokenCookie(res, refreshToken);
    if (token) tokenUtils.setBetterAuthSessionCookie(res, token);

    // First real "logged in" moment after registration - merge here too.
    if (result.user?.id) {
        await mergeGuestCartIfPresent(req, res, result.user.id);
    }

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Email verified successfully",
        data: { token, accessToken, refreshToken, ...rest },
    });
});

const resendVerificationOtp = catchAsync(
    async (req: Request, res: Response) => {
        const { email } = req.body;
        await AuthService.resendVerificationOtp(email);

        sendResponse(res, {
            httpStatusCode: status.OK,
            success: true,
            message: "New verification OTP sent to email",
        });
    },
);

const resendPasswordResetOtp = catchAsync(
    async (req: Request, res: Response) => {
        const { email } = req.body;
        await AuthService.resendPasswordResetOtp(email);

        sendResponse(res, {
            httpStatusCode: status.OK,
            success: true,
            message: "New password reset OTP sent to email",
        });
    },
);

const forgetPassword = catchAsync(async (req: Request, res: Response) => {
    const { email } = req.body;
    await AuthService.forgetPassword(email);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Password reset OTP sent to email successfully",
    });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
    const { email, otp, newPassword } = req.body;
    await AuthService.resetPassword(email, otp, newPassword);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Password reset successfully",
    });
});

const googleLogin = catchAsync(async (req: Request, res: Response) => {
    const redirectPath = (req.query.redirect as string) || "/dashboard";
    const encodedRedirectPath = encodeURIComponent(redirectPath);
    const callbackURL = `${envVars.BETTER_AUTH_URL}/api/v1/auth/google/success?redirect=${encodedRedirectPath}`;

    // Start the OAuth flow server-side so the state cookie is set on the same
    // top-level navigation that eventually returns from Google. Using a
    // client-side fetch (the old template) set the state cookie in an XHR
    // context, which browsers may not send back on the callback navigation —
    // causing "please_restart_the_process" -> oauth_failed.
    const { response, headers } = await auth.api.signInSocial({
        body: { provider: "google", callbackURL },
        returnHeaders: true,
    });

    // Forward the Set-Cookie header(s) better-auth produced (the state cookie).
    const setCookie = headers.get("set-cookie");
    if (setCookie) {
        res.setHeader("set-cookie", setCookie);
    }

    if (!response?.url) {
        return res.redirect(
            `${envVars.FRONTEND_URL}/login?error=oauth_failed`,
        );
    }

    return res.redirect(response.url);
});

const googleLoginSuccess = catchAsync(async (req: Request, res: Response) => {
    const redirectPath = (req.query.redirect as string) || "/dashboard";
    const sessionToken = req.cookies["better-auth.session_token"];

    if (!sessionToken) {
        return res.redirect(
            `${envVars.FRONTEND_URL}/login?error=oauth_failed`,
        );
    }

    const session = await auth.api.getSession({
        headers: { Cookie: `better-auth.session_token=${sessionToken}` },
    });

    if (!session) {
        return res.redirect(
            `${envVars.FRONTEND_URL}/login?error=no_session_found`,
        );
    }

    if (!session.user) {
        return res.redirect(
            `${envVars.FRONTEND_URL}/login?error=no_user_found`,
        );
    }

    const result = await AuthService.googleLoginSuccess(session);
    const { accessToken, refreshToken } = result;

    tokenUtils.setAccessTokenCookie(res, accessToken);
    tokenUtils.setRefreshTokenCookie(res, refreshToken);

    await mergeGuestCartIfPresent(req, res, session.user.id);

    const isValidRedirectPath =
        redirectPath.startsWith("/") && !redirectPath.startsWith("//");
    const finalRedirectPath = isValidRedirectPath ? redirectPath : "/dashboard";

    res.redirect(`${envVars.FRONTEND_URL}${finalRedirectPath}`);
});

const handleOAuthError = catchAsync((req: Request, res: Response) => {
    const error = (req.query.error as string) || "oauth_failed";
    res.redirect(`${envVars.FRONTEND_URL}/login?error=${error}`);
});

export const AuthController = {
    registerUser,
    loginUser,
    getMe,
    updateOwnProfile,
    getNewToken,
    changePassword,
    logoutUser,
    verifyEmail,
    resendVerificationOtp,
    resendPasswordResetOtp,
    forgetPassword,
    resetPassword,
    googleLogin,
    googleLoginSuccess,
    handleOAuthError,
};
