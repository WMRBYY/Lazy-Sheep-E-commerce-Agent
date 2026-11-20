import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import type { ShopWorkflowCategory } from "@/pages/shop/shop-canvas-workflows";
import { compactApiParams, http } from "./request";

export type ShopWorkflowStatus = "pending" | "approved" | "rejected";

export const shopWorkflowStatusLabel: Record<ShopWorkflowStatus, string> = {
    pending: "待审核",
    approved: "已通过",
    rejected: "未通过",
};

export type ShopWorkflowSubmission = {
    id: string;
    submitterId: string;
    workflowId: string;
    name: string;
    category: ShopWorkflowCategory;
    description?: string;
    nodeCount: number;
    coverResourceId?: string;
    status: ShopWorkflowStatus;
    reviewNote?: string;
    reviewedAt?: string;
    createdAt: string;
};

type ShopWorkflowReviewNode = Pick<CanvasLayer, "id" | "type" | "x" | "y" | "text" | "prompt" | "draftKind" | "materialCategory" | "resourceId" | "inputs">;

export function submitShopWorkflow(input: { workflowId: string; name: string; category: ShopWorkflowCategory; description: string; nodes: ShopWorkflowReviewNode[] }) {
    return http.post<ShopWorkflowSubmission>("/shop/workflow-submissions", input);
}

export function getMyShopWorkflowSubmission(workflowId: string, signal?: AbortSignal) {
    return http.get<{ submission: ShopWorkflowSubmission | null }>(`/shop/workflow-submissions/${encodeURIComponent(workflowId)}`, { signal });
}

export function listAdminShopWorkflowSubmissions(params: { status?: ShopWorkflowStatus; category?: ShopWorkflowCategory; q?: string; page: number; pageSize: number }, signal?: AbortSignal) {
    return http.get<{ items: ShopWorkflowSubmission[]; total: number }>("/admin/shop-workflow-submissions", { params: compactApiParams(params), signal });
}

export function getAdminShopWorkflowSubmission(id: string, signal?: AbortSignal) {
    return http.get<ShopWorkflowSubmission & { nodes: ShopWorkflowReviewNode[] }>(`/admin/shop-workflow-submissions/${encodeURIComponent(id)}`, { signal });
}

export function reviewAdminShopWorkflow(id: string, status: Exclude<ShopWorkflowStatus, "pending">, note?: string) {
    return http.patch<{ reviewed: boolean }>(`/admin/shop-workflow-submissions/${encodeURIComponent(id)}/review`, { status, note });
}
