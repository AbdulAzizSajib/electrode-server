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
