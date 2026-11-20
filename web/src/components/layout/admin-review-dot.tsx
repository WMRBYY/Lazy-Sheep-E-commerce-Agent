import "./admin-review-dot.css";

export function AdminReviewDot({ count }: { count: number }) {
    return count > 0 ? <span className="admin-review-dot" aria-hidden="true" /> : null;
}
