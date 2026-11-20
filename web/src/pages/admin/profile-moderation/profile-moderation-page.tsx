import { Alert, Button, Image, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { listProfileModerationRecords, profileModerationImageUrl, type ProfileModerationRecord } from "@/services/api/profile-moderation";
import { Select } from "@/components/ui/base/select";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, PaginationBar } from "../components/admin-ui";

const statusMeta: Record<ProfileModerationRecord["status"], { label: string; tone: "neutral" | "success" | "warning" | "error" }> = {
    pass: { label: "通过", tone: "success" },
    block: { label: "已替换", tone: "error" },
    blocked: { label: "已替换", tone: "error" },
    review: { label: "疑似风险已替换", tone: "warning" },
};

export default function ProfileModerationPage() {
    const [records, setRecords] = useState<ProfileModerationRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void listProfileModerationRecords({ status: status || undefined, page, pageSize }, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) return;
                setRecords(data.records);
                setTotal(data.total);
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取审核记录失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [status, page, pageSize, refresh]);

    const columns: ColumnsType<ProfileModerationRecord> = [
        { title: "时间", width: 170, render: (_, row) => dayjs(row.createdAt).format("YYYY-MM-DD HH:mm:ss") },
        {
            title: "用户",
            width: 180,
            render: (_, row) => (
                <div>
                    <div className="font-medium">{row.userDisplayName || "未设置昵称"}</div>
                    <div className="font-mono text-xs text-muted-foreground">@{row.username || row.userId}</div>
                </div>
            ),
        },
        { title: "内容", width: 110, render: (_, row) => (row.kind === "nickname" ? "昵称" : "头像") },
        {
            title: "提交内容",
            width: 260,
            render: (_, row) =>
                row.kind === "avatar" && row.status !== "pass" ? (
                    <Image src={profileModerationImageUrl(row.id)} alt="用户提交的原头像" width={52} height={52} className="rounded" preview />
                ) : row.kind === "avatar" ? (
                    "头像通过"
                ) : (
                    <span className="break-all">{row.originalValue || ""}</span>
                ),
        },
        { title: "处理结果", width: 140, render: (_, row) => <AdminStatusBadge label={statusMeta[row.status].label} tone={statusMeta[row.status].tone} /> },
        { title: "替换结果", width: 170, render: (_, row) => (row.kind === "nickname" ? row.resultValue : row.status === "pass" ? "原头像保留" : "纯白头像") },
        {
            title: "模型 / 分数",
            width: 210,
            render: (_, row) =>
                row.kind === "avatar" ? (
                    <span>
                        {row.model || "本地模型"} · {Math.round((row.score || 0) * 100)}%
                    </span>
                ) : (
                    <span>内置昵称词表</span>
                ),
        },
        { title: "判定说明", dataIndex: "reason", width: 240, render: (value: string) => <span className="whitespace-normal">{value}</span> },
    ];

    return (
        <AdminPageFrame
            title="头像与昵称审核"
            description="昵称命中词表后自动改为“违规昵称”，头像识别到色情或疑似风险后自动换成纯白图。"
            scroll
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => setRefresh((value) => value + 1)}>
                    刷新
                </Button>
            }
        >
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Select
                    ariaLabel="审核结果筛选"
                    value={status}
                    className="w-44"
                    options={[
                        { value: "", label: "全部结果" },
                        { value: "blocked", label: "违规已替换" },
                        { value: "review", label: "疑似风险已替换" },
                        { value: "pass", label: "通过" },
                    ]}
                    onChange={(value) => {
                        setPage(1);
                        setStatus(value);
                    }}
                />
                <span className="text-sm text-muted-foreground">共 {total} 条记录</span>
            </div>
            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
            <Table<ProfileModerationRecord> rowKey="id" size="middle" loading={loading} columns={columns} dataSource={records} pagination={false} scroll={{ x: 1260 }} locale={{ emptyText: loading ? "" : "暂无审核记录" }} />
            <div className="mt-4">
                <PaginationBar
                    current={page}
                    pageSize={pageSize}
                    total={total}
                    onChange={(nextPage, nextSize) => {
                        setPage(nextPage);
                        setPageSize(nextSize);
                    }}
                />
            </div>
        </AdminPageFrame>
    );
}
