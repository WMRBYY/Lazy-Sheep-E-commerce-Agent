import { http } from "./request";

export type AdminReviewCounts = {
    shopWorkflows: number;
    canvasTemplates: number;
    feedback: number;
};

export const ADMIN_REVIEW_COUNTS_QUERY_KEY = ["admin-review-counts"] as const;

export function getAdminReviewCounts(signal?: AbortSignal) {
    return http.get<AdminReviewCounts>("/admin/review-counts", { signal });
}
