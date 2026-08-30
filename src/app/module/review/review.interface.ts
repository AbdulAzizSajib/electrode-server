export interface ICreateReviewPayload {
    rating: number;
    title?: string;
    comment?: string;
}

export interface IUpdateReviewStatusPayload {
    status: "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN";
}

export interface IAdminReplyPayload {
    adminReply: string;
}

/** Author-scoped edit. All fields optional, but at least one is required (enforced in the Zod schema). */
export interface IUpdateMyReviewPayload {
    rating?: number;
    title?: string;
    comment?: string;
}
