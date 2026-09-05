import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { HOME_TESTIMONIAL_COUNT } from "./testimonial.constant";
import { TestimonialService } from "./testimonial.service";

const createTestimonial = catchAsync(async (req: Request, res: Response) => {
    const result = await TestimonialService.createTestimonial(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Testimonial created successfully",
        data: result,
    });
});

const getAdminTestimonials = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await TestimonialService.getAdminTestimonials(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Testimonials fetched successfully",
        data,
        // The section's own count travels with the list, so the admin can mark
        // the published entries falling beyond it without keeping its own copy
        // of the number — a label that promises "only the first four appear"
        // has to be reading the four from whoever enforces it.
        meta: { ...meta, homeSectionCount: HOME_TESTIMONIAL_COUNT },
    });
});

const getTestimonialById = catchAsync(async (req: Request, res: Response) => {
    const result = await TestimonialService.getTestimonialOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Testimonial fetched successfully",
        data: result,
    });
});

const updateTestimonial = catchAsync(async (req: Request, res: Response) => {
    const result = await TestimonialService.updateTestimonial(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Testimonial updated successfully",
        data: result,
    });
});

const deleteTestimonial = catchAsync(async (req: Request, res: Response) => {
    const result = await TestimonialService.deleteTestimonial(
        req.user.userId,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Testimonial deleted successfully",
        data: result,
    });
});

/**
 * Public: PUBLISHED only, in the merchant's order, bounded to what the homepage
 * section renders.
 *
 * `?limit=all` lifts the bound, for a page that lists every testimonial. The
 * default is the section's own count so the common call ships exactly what is
 * displayed.
 */
const getPublicTestimonials = catchAsync(async (req: Request, res: Response) => {
    const take = req.query.limit === "all" ? undefined : HOME_TESTIMONIAL_COUNT;

    const result = await TestimonialService.getPublishedTestimonials(take);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Testimonials fetched successfully",
        data: result,
    });
});

export const TestimonialController = {
    createTestimonial,
    getAdminTestimonials,
    getTestimonialById,
    updateTestimonial,
    deleteTestimonial,
    getPublicTestimonials,
};
