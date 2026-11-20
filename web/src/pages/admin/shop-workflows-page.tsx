import { useState } from "react";
import { App, Button, Input, Pagination, Select, Spin } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useNavigate } from "react-router";
import { AdminReviewDot } from "@/components/layout/admin-review-dot";
import { useAdminReviewCounts } from "@/hooks/use-admin-review-counts";
import { copyWorkflowProject, SHOP_WORKFLOW_CATEGORIES, SYSTEM_WORKFLOWS, type ShopWorkflow, type ShopWorkflowCategory } from "@/pages/shop/shop-canvas-workflows";
import { workflowCover } from "@/pages/shop/shop-workflow-artwork";
import { ShopWorkflowCard } from "@/pages/shop/shop-workflow-card";
import { ShopWorkflowPreview } from "@/pages/shop/shop-workflow-preview";
import { ADMIN_REVIEW_COUNTS_QUERY_KEY } from "@/services/api/admin-review-counts";
import { adminResourceFileUrl } from "@/services/api/admin-storage";
import type { ResourceAccessVariant } from "@/services/api/resources";
import { getAdminShopWorkflowSubmission, listAdminShopWorkflowSubmissions, reviewAdminShopWorkflow, shopWorkflowStatusLabel, type ShopWorkflowStatus } from "@/services/api/shop-workflows";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminEmpty, AdminStatusBadge } from "./components/admin-ui";
import { AdminSegmented } from "./ui/controls";
import { AdminModal } from "./ui/overlays";
import "./shop-workflows-page.css";

const PAGE_SIZE = 24;
const SUBMISSIONS_QUERY_KEY = ["admin-shop-workflow-submissions"] as const;
const statusTone = { pending: "warning", approved: "success", rejected: "error" } as const;
const resourceUrl = (id: string, variant: ResourceAccessVariant = "original") => `${adminResourceFileUrl(id)}?variant=${variant}`;
type Source = "system" | "submissions";
type Selection = { workflow: ShopWorkflow } | { id: string; name: string };

export default function ShopWorkflowsPage() {
    const userId = useUserStore((state) => state.user?.id);
    const [source, setSource] = useState<Source>("system");
    const [category, setCategory] = useState<ShopWorkflowCategory | "all">("all");
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<ShopWorkflowStatus | "all">("pending");
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<Selection | null>(null);
    const [rejecting, setRejecting] = useState(false);
    const [note, setNote] = useState("");
    const { message } = App.useApp();
    const navigate = useNavigate();
    const client = useQueryClient();
    const pending = useAdminReviewCounts()?.shopWorkflows ?? 0;
    const submitted = selected && "id" in selected ? selected : null;
    const q = keyword.trim();
    const submissions = useQuery({
        queryKey: [...SUBMISSIONS_QUERY_KEY, userId, status, category, q, page],
        queryFn: ({ signal }) => listAdminShopWorkflowSubmissions({ status: status === "all" ? undefined : status, category: category === "all" ? undefined : category, q, page, pageSize: PAGE_SIZE }, signal),
        enabled: Boolean(userId) && source === "submissions",
        refetchOnWindowFocus: true,
        refetchInterval: 30_000,
    });
    const detail = useQuery({
        queryKey: ["admin-shop-workflow-detail", userId, submitted?.id],
        queryFn: ({ signal }) => getAdminShopWorkflowSubmission(submitted!.id, signal),
        enabled: Boolean(userId && submitted),
        refetchOnWindowFocus: true,
    });
    const systemWorkflow = selected && "workflow" in selected ? selected.workflow : undefined;
    const copy = useMutation({
        mutationFn: async (workflow: ShopWorkflow) => {
            if (!userId) throw new Error("请先登录");
            return copyWorkflowProject(userId, userId, workflow);
        },
        onSuccess: (project) => navigate(`/shop/canvas/${project.id}`),
        onError: () => message.error("复制失败，请检查浏览器存储空间后重试"),
    });
    const refreshReviews = () => {
        void client.invalidateQueries({ queryKey: SUBMISSIONS_QUERY_KEY });
        void client.invalidateQueries({ queryKey: ADMIN_REVIEW_COUNTS_QUERY_KEY });
        void client.invalidateQueries({ queryKey: ["admin-shop-workflow-detail", userId, submitted?.id] });
    };
    const review = useMutation({
        mutationFn: (input: { id: string; decision: Exclude<ShopWorkflowStatus, "pending">; note?: string }) => reviewAdminShopWorkflow(input.id, input.decision, input.note),
        onSuccess: (_, { decision }) => {
            setRejecting(false);
            setSelected(null);
            setPage(1);
            refreshReviews();
            message.success(decision === "approved" ? "工作流已通过审核" : "工作流已拒绝");
        },
        onError: (error) => {
            refreshReviews();
            message.error(error instanceof Error ? error.message : "审核操作失败，请重试");
        },
    });

    const systemCards = SYSTEM_WORKFLOWS.filter((workflow) => (category === "all" || workflow.category === category) && `${workflow.name} ${workflow.description || ""}`.toLowerCase().includes(q.toLowerCase()));
    const row = detail.data;
    const workflow = systemWorkflow ?? (row ? { id: row.id, name: row.name, description: row.description, category: row.category, cover: row.coverResourceId ? resourceUrl(row.coverResourceId) : undefined, nodes: row.nodes } : null);
    const readOnlyNotice = row ? (
        <div className="admin-shop-workflow-review-info">
            <AdminStatusBadge label={shopWorkflowStatusLabel[row.status]} tone={statusTone[row.status]} />
            <small>
                投稿账号 {row.submitterId} · {new Date(row.createdAt).toLocaleString("zh-CN", { hour12: false })}
            </small>
            {row.reviewNote ? <p>审核意见 · {row.reviewNote}</p> : null}
        </div>
    ) : null;

    return (
        <AdminPageFrame title="电商工作流" description="查看系统模板，审核用户提交的电商工作流。" scroll>
            <section className="admin-shop-workflows" aria-label="电商工作流">
                <div className="admin-shop-workflow-toolbar">
                    <AdminSegmented<Source>
                        ariaLabel="工作流来源"
                        value={source}
                        onChange={(value) => {
                            setSource(value);
                            setPage(1);
                        }}
                        options={[
                            { value: "system", label: "系统模板" },
                            {
                                value: "submissions",
                                label: (
                                    <span className="admin-shop-workflow-tab">
                                        用户投稿
                                        <AdminReviewDot count={pending} />
                                        {pending > 0 ? <span className="sr-only">{pending} 条待审核</span> : null}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <Input
                        className="admin-shop-workflow-search"
                        aria-label="搜索工作流"
                        placeholder="搜索工作流"
                        prefix={<Search size={15} aria-hidden="true" />}
                        allowClear
                        maxLength={160}
                        value={keyword}
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                </div>
                <div className="admin-shop-workflow-filters">
                    <AdminSegmented<ShopWorkflowCategory | "all">
                        ariaLabel="工作流分类"
                        value={category}
                        options={[{ value: "all", label: "全部" }, ...SHOP_WORKFLOW_CATEGORIES.map((value) => ({ value }))]}
                        onChange={(value) => {
                            setCategory(value);
                            setPage(1);
                        }}
                    />
                    {source === "submissions" ? (
                        <Select<ShopWorkflowStatus | "all">
                            aria-label="投稿审核状态"
                            value={status}
                            options={[{ value: "all", label: "全部状态" }, ...Object.entries(shopWorkflowStatusLabel).map(([value, label]) => ({ value, label }))]}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                        />
                    ) : null}
                </div>
                {source === "system" ? (
                    systemCards.length ? (
                        <div className="sp-workflow-cards">
                            {systemCards.map((item) => (
                                <ShopWorkflowCard key={item.id} name={item.name} description={item.description} image={workflowCover(item.id, true)} onOpen={() => setSelected({ workflow: item })} />
                            ))}
                        </div>
                    ) : (
                        <AdminEmpty title="没有匹配的工作流" description="试试其他关键词或分类。" />
                    )
                ) : submissions.isPending ? (
                    <div className="admin-shop-workflow-loading" role="status">
                        <Spin />
                        正在读取投稿
                    </div>
                ) : submissions.isError ? (
                    <AdminEmpty title="无法读取工作流投稿" action={<Button onClick={() => void submissions.refetch()}>重试</Button>} />
                ) : (
                    <>
                        {submissions.data.items.length ? (
                            <div className="sp-workflow-cards">
                                {submissions.data.items.map((item) => (
                                    <ShopWorkflowCard
                                        key={item.id}
                                        name={item.name}
                                        description={item.description || `${item.category} · ${item.nodeCount} 个节点`}
                                        image={item.coverResourceId ? resourceUrl(item.coverResourceId, "thumbnail") : undefined}
                                        badge={
                                            <>
                                                <AdminReviewDot count={Number(item.status === "pending")} />
                                                {shopWorkflowStatusLabel[item.status]}
                                            </>
                                        }
                                        onOpen={() => setSelected({ id: item.id, name: item.name })}
                                    />
                                ))}
                            </div>
                        ) : (
                            <AdminEmpty title={status === "pending" && !q && category === "all" ? "暂无待审核的工作流" : "没有匹配的投稿"} description="用户从「我的工作流」提交后会显示在这里。" />
                        )}
                        {submissions.data.total > PAGE_SIZE || page > 1 ? <Pagination className="admin-shop-workflow-pagination" current={page} pageSize={PAGE_SIZE} total={submissions.data.total} showSizeChanger={false} onChange={setPage} /> : null}
                    </>
                )}
            </section>
            <ShopWorkflowPreview
                workflow={workflow}
                title={submitted?.name}
                placeholder={
                    detail.isError ? (
                        <AdminEmpty title="无法读取工作流详情" action={<Button onClick={() => void detail.refetch()}>重试</Button>} />
                    ) : (
                        <div className="admin-shop-workflow-loading" role="status">
                            <Spin />
                            正在读取工作流
                        </div>
                    )
                }
                onClose={() => {
                    if (!review.isPending) setSelected(null);
                }}
                onCopy={systemWorkflow ? () => copy.mutate(systemWorkflow) : undefined}
                busy={copy.isPending}
                mediaUrl={resourceUrl}
                notice={readOnlyNotice}
                actions={
                    row?.status === "pending" ? (
                        <>
                            <Button
                                danger
                                disabled={review.isPending}
                                onClick={() => {
                                    setNote("");
                                    setRejecting(true);
                                }}
                            >
                                拒绝
                            </Button>
                            <Button type="primary" loading={review.isPending && !rejecting} disabled={rejecting} onClick={() => review.mutate({ id: row.id, decision: "approved" })}>
                                通过审核
                            </Button>
                        </>
                    ) : null
                }
            />
            <AdminModal
                open={rejecting && row?.status === "pending"}
                title="拒绝工作流投稿"
                okText="拒绝投稿"
                cancelText="取消"
                okButtonProps={{ danger: true, disabled: !note.trim() }}
                confirmLoading={review.isPending}
                onCancel={() => {
                    if (!review.isPending) setRejecting(false);
                }}
                onOk={() => {
                    if (row && note.trim()) review.mutate({ id: row.id, decision: "rejected", note: note.trim() });
                }}
            >
                <Input.TextArea autoFocus aria-label="拒绝原因" placeholder="填写拒绝原因，投稿者可查看" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} />
            </AdminModal>
        </AdminPageFrame>
    );
}
