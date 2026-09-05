import { TestimonialStatus } from "../../../generated/prisma/client";

export interface ICreateTestimonialPayload {
    quote: string;
    authorName: string;
    /** The caption under the name — "Verified Buyer", "CEO, Acme". Free text. */
    authorRole: string;
    /** Optional. The storefront renders the author's initials when absent. */
    photoUrl?: string;
    /** Whole stars, 1-5. Replaces the storefront's previously hardcoded 5. */
    rating?: number;
    status?: TestimonialStatus;
    sortOrder?: number;
}

export type IUpdateTestimonialPayload = Partial<ICreateTestimonialPayload>;
