import status from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { RoleName } from "../../constants/role.constant";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import { tokenUtils } from "../../utils/token";
import {
    IChangePasswordPayload,
    ILoginUserPayload,
    IRegisterUserPayload,
} from "./auth.interface";

// `role` is a Prisma relation (User.roleId -> Role), not a flat scalar, so
// callers (including better-auth's own API responses) cannot be trusted to
// carry it. Always re-fetch the user with its role included, keyed by id,
// so the token payload reflects the current role from the database.
const buildTokenPayload = async (user: {
    id: string;
    name: string;
    email: string;
    isActive?: boolean | null;
    isDeleted?: boolean | null;
    emailVerified: boolean;
}) => {
    const fullUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { role: true },
    });

    return {
        userId: user.id,
        role: fullUser.role.name as RoleName,
        name: user.name,
        email: user.email,
        isActive: user.isActive ?? true,
        isDeleted: user.isDeleted ?? false,
        emailVerified: user.emailVerified,
    };
};

const registerUser = async (payload: IRegisterUserPayload) => {
    const { name, email, password, contactNumber } = payload;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new AppError(status.CONFLICT, "User with this email already exists");
    }

    const existingContact = await prisma.user.findFirst({ where: { contactNumber } });
    if (existingContact) {
        throw new AppError(status.CONFLICT, "User with this contact number already exists");
    }

    const data = await auth.api.signUpEmail({
        body: {
            name,
            email,
            password,
        },
    });

    if (!data.user) {
        throw new AppError(status.BAD_REQUEST, "Failed to register user");
    }

    try {
        const updatedUser = await prisma.user.update({
            where: { id: data.user.id },
            data: { contactNumber },
        });

        // No tokens here: email must be verified via OTP first.
        // Tokens are issued after successful email verification.
        return {
            user: updatedUser,
        };
    } catch (error) {
        await prisma.user.delete({ where: { id: data.user.id } });
        throw error;
    }
};

const loginUser = async (payload: ILoginUserPayload) => {
    const { email, password } = payload;

    const data = await auth.api.signInEmail({
        body: { email: email.trim().toLowerCase(), password },
    });

    if (!data.user.isActive) {
        throw new AppError(status.FORBIDDEN, "User account is inactive");
    }

    if (data.user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    await prisma.user.update({
        where: { id: data.user.id },
        data: { lastLoginAt: new Date() },
    });

    const tokenPayload = await buildTokenPayload(data.user);
    const accessToken = tokenUtils.getAccessToken(tokenPayload);
    const refreshToken = tokenUtils.getRefreshToken(tokenPayload);

    return { ...data, accessToken, refreshToken };
};

const getMe = async (user: IRequestUser) => {
    const isUserExists = await prisma.user.findUnique({
        where: { id: user.userId },
    });

    if (!isUserExists) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return isUserExists;
};

const getNewToken = async (refreshToken: string, rawSessionToken: string) => {
    // Better Auth stores cookie as "{token}.{signature}" but DB has only "{token}"
    const sessionToken = rawSessionToken.includes(".")
        ? rawSessionToken.split(".")[0]
        : rawSessionToken;

    const isSessionTokenExists = await prisma.session.findUnique({
        where: { token: sessionToken },
        include: { user: true },
    });

    if (!isSessionTokenExists) {
        throw new AppError(status.UNAUTHORIZED, "Invalid session token");
    }

    const verifiedRefreshToken = jwtUtils.verifyToken(
        refreshToken,
        envVars.REFRESH_TOKEN_SECRET,
    );

    if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
        throw new AppError(status.UNAUTHORIZED, "Invalid refresh token");
    }

    const data = verifiedRefreshToken.data as JwtPayload;

    const tokenPayload = {
        userId: data.userId,
        role: data.role,
        name: data.name,
        email: data.email,
        isActive: data.isActive,
        isDeleted: data.isDeleted,
        emailVerified: data.emailVerified,
    };

    const newAccessToken = tokenUtils.getAccessToken(tokenPayload);
    const newRefreshToken = tokenUtils.getRefreshToken(tokenPayload);

    const { token } = await prisma.session.update({
        where: { token: sessionToken },
        data: {
            expiresAt: new Date(Date.now() + 60 * 60 * 24 * 7 * 1000),
            updatedAt: new Date(),
        },
    });

    return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        sessionToken: token,
    };
};

const changePassword = async (
    payload: IChangePasswordPayload,
    sessionToken: string,
) => {
    const session = await auth.api.getSession({
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    });

    if (!session) {
        throw new AppError(status.UNAUTHORIZED, "Invalid session token");
    }

    const { currentPassword, newPassword } = payload;

    const result = await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    });

    if (session.user.needPasswordChange) {
        await prisma.user.update({
            where: { id: session.user.id },
            data: { needPasswordChange: false },
        });
    }

    const tokenPayload = await buildTokenPayload(session.user);
    const accessToken = tokenUtils.getAccessToken(tokenPayload);
    const refreshToken = tokenUtils.getRefreshToken(tokenPayload);

    return { ...result, accessToken, refreshToken };
};

const logoutUser = async (sessionToken: string) => {
    const result = await auth.api.signOut({
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    });

    return result;
};

const verifyEmail = async (email: string, otp: string) => {
    const result = await auth.api.verifyEmailOTP({ body: { email, otp } });

    if (!result.status) {
        throw new AppError(status.BAD_REQUEST, "Invalid or expired OTP");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    if (!user.emailVerified) {
        await prisma.user.update({
            where: { email },
            data: { emailVerified: true },
        });
        user.emailVerified = true;
    }

    const tokenPayload = await buildTokenPayload(user);
    const accessToken = tokenUtils.getAccessToken(tokenPayload);
    const refreshToken = tokenUtils.getRefreshToken(tokenPayload);

    return { ...result, accessToken, refreshToken };
};

const resendVerificationOtp = async (email: string) => {
    const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerified: true, isActive: true, isDeleted: true },
    });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (user.emailVerified) {
        throw new AppError(status.BAD_REQUEST, "Email is already verified");
    }

    if (!user.isActive) {
        throw new AppError(status.FORBIDDEN, "Account is inactive");
    }

    await auth.api.sendVerificationOTP({
        body: { email, type: "email-verification" },
    });
};

const resendPasswordResetOtp = async (email: string) => {
    const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerified: true, isActive: true, isDeleted: true },
    });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (!user.emailVerified) {
        throw new AppError(status.BAD_REQUEST, "Email not verified");
    }

    if (!user.isActive) {
        throw new AppError(status.FORBIDDEN, "Account is inactive");
    }

    await auth.api.sendVerificationOTP({
        body: { email, type: "forget-password" },
    });
};

const forgetPassword = async (email: string) => {
    const isUserExist = await prisma.user.findUnique({ where: { email } });

    if (!isUserExist) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (!isUserExist.emailVerified) {
        throw new AppError(status.BAD_REQUEST, "Email not verified");
    }

    if (isUserExist.isDeleted || !isUserExist.isActive) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    await auth.api.requestPasswordResetEmailOTP({ body: { email } });
};

const resetPassword = async (
    email: string,
    otp: string,
    newPassword: string,
) => {
    const isUserExist = await prisma.user.findUnique({ where: { email } });

    if (!isUserExist) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (!isUserExist.emailVerified) {
        throw new AppError(status.BAD_REQUEST, "Email not verified");
    }

    if (isUserExist.isDeleted || !isUserExist.isActive) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    await auth.api.resetPasswordEmailOTP({
        body: { email, otp, password: newPassword },
    });

    if (isUserExist.needPasswordChange) {
        await prisma.user.update({
            where: { id: isUserExist.id },
            data: { needPasswordChange: false },
        });
    }

    await prisma.session.deleteMany({ where: { userId: isUserExist.id } });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const googleLoginSuccess = async (session: Record<string, any>) => {
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
    });

    if (!user) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    const tokenPayload = await buildTokenPayload(user);
    const accessToken = tokenUtils.getAccessToken(tokenPayload);
    const refreshToken = tokenUtils.getRefreshToken(tokenPayload);

    return { accessToken, refreshToken };
};

export const AuthService = {
    registerUser,
    loginUser,
    getMe,
    getNewToken,
    changePassword,
    logoutUser,
    verifyEmail,
    resendVerificationOtp,
    resendPasswordResetOtp,
    forgetPassword,
    resetPassword,
    googleLoginSuccess,
};
