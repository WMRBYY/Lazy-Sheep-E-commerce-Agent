import { useQuery } from "@tanstack/react-query";
import { ADMIN_REVIEW_COUNTS_QUERY_KEY, getAdminReviewCounts, type AdminReviewCounts } from "@/services/api/admin-review-counts";
import { useUserStore } from "@/stores/use-user-store";

export function useAdminReviewCounts() {
    const adminId = useUserStore((state) => (state.user?.role === "admin" ? state.user.id : undefined));
    const query = useQuery({
        queryKey: [...ADMIN_REVIEW_COUNTS_QUERY_KEY, adminId],
        queryFn: ({ signal }) => getAdminReviewCounts(signal),
        enabled: Boolean(adminId),
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
    });
    return adminId ? query.data : undefined;
}

export function adminReviewTotal(counts?: AdminReviewCounts) {
    return counts ? Object.values(counts).reduce((total, value) => total + value, 0) : 0;
}
