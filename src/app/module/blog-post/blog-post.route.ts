import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BlogPostController } from "./blog-post.controller";
import { createBlogPostZodSchema, updateBlogPostZodSchema } from "./blog-post.validation";

const router = Router();

/*
 * Literal segments MUST stay above the `/:slug` mount at the bottom. Express
 * matches in declaration order, so a route registered after it would never be
 * reached — `/blog-posts/admin` would resolve as "the published post whose slug
 * is 'admin'" and 404, and `/blog-posts/recent` likewise. Same reason
 * `/pages/admin` sits above `/pages/:slug` in page.route.ts.
 */

// Admin (any status)
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BlogPostController.getAdminBlogPosts,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BlogPostController.getBlogPostById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createBlogPostZodSchema),
    BlogPostController.createBlogPost,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateBlogPostZodSchema),
    BlogPostController.updateBlogPost,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BlogPostController.deleteBlogPost,
);

// Public (PUBLISHED only)
router.get("/recent", BlogPostController.getRecentBlogPosts);
router.get("/", BlogPostController.getPublicBlogPosts);
router.get("/:slug", BlogPostController.getPublicBlogPostBySlug);

export const BlogPostRoutes = router;
