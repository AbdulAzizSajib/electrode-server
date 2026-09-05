import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { HOME_BLOG_POST_COUNT } from "./blog-post.constant";
import { BlogPostService } from "./blog-post.service";

const createBlogPost = catchAsync(async (req: Request, res: Response) => {
    const result = await BlogPostService.createBlogPost(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Blog post created successfully",
        data: result,
    });
});

const getAdminBlogPosts = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await BlogPostService.getAdminBlogPosts(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog posts fetched successfully",
        data,
        meta,
    });
});

const getBlogPostById = catchAsync(async (req: Request, res: Response) => {
    const result = await BlogPostService.getBlogPostOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog post fetched successfully",
        data: result,
    });
});

const updateBlogPost = catchAsync(async (req: Request, res: Response) => {
    const result = await BlogPostService.updateBlogPost(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog post updated successfully",
        data: result,
    });
});

const deleteBlogPost = catchAsync(async (req: Request, res: Response) => {
    const result = await BlogPostService.deleteBlogPost(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog post deleted successfully",
        data: result,
    });
});

/** Public: PUBLISHED only, newest first, paginated — the storefront's blog index. */
const getPublicBlogPosts = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await BlogPostService.getPublishedBlogPosts(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog posts fetched successfully",
        data,
        meta,
    });
});

/**
 * Public: the homepage section's fixed handful.
 *
 * Separate from the paginated list so the homepage asks one question and gets
 * one answer, without pagination metadata it would ignore. The count is the
 * server's, matching the section's four-across grid.
 */
const getRecentBlogPosts = catchAsync(async (_req: Request, res: Response) => {
    const result = await BlogPostService.getRecentPublishedBlogPosts(HOME_BLOG_POST_COUNT);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog posts fetched successfully",
        data: result,
    });
});

const getPublicBlogPostBySlug = catchAsync(async (req: Request, res: Response) => {
    const result = await BlogPostService.getPublishedBlogPostBySlug(req.params.slug as string);

    // A DRAFT and a non-existent slug both land here, deliberately: the
    // response must not let a visitor distinguish an unpublished post from one
    // that was never written.
    if (!result) {
        throw new AppError(status.NOT_FOUND, "Blog post not found");
    }

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Blog post fetched successfully",
        data: result,
    });
});

export const BlogPostController = {
    createBlogPost,
    getAdminBlogPosts,
    getBlogPostById,
    updateBlogPost,
    deleteBlogPost,
    getPublicBlogPosts,
    getRecentBlogPosts,
    getPublicBlogPostBySlug,
};
