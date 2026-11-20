import { useState } from "react";
import { App, Button, Form, Input, Select, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { ADMIN_REVIEW_COUNTS_QUERY_KEY } from "@/services/api/admin-review-counts";
import { getMyShopWorkflowSubmission, shopWorkflowStatusLabel, submitShopWorkflow } from "@/services/api/shop-workflows";
import { SHOP_WORKFLOW_CATEGORIES, type ShopWorkflow, type ShopWorkflowCategory } from "./shop-canvas-workflows";

type SubmissionForm = { category: ShopWorkflowCategory; description?: string };

export function ShopWorkflowSubmit({ workflow, userId }: { workflow: ShopWorkflow; userId: string }) {
    const [open, setOpen] = useState(false);
    const [form] = Form.useForm<SubmissionForm>();
    const { message } = App.useApp();
    const client = useQueryClient();
    const queryKey = ["my-shop-workflow-submission", userId, workflow.id] as const;
    const query = useQuery({ queryKey, queryFn: ({ signal }) => getMyShopWorkflowSubmission(workflow.id, signal), refetchOnWindowFocus: true });
    const submission = query.data?.submission;
    const mutation = useMutation({
        mutationFn: (values: SubmissionForm) =>
            submitShopWorkflow({
                workflowId: workflow.id,
                name: workflow.name,
                category: values.category,
                description: values.description?.trim() ?? "",
                // The review snapshot includes visible graph fields, never the node's generation configuration.
                nodes: workflow.nodes.map(({ id, type, x, y, text, prompt, draftKind, materialCategory, resourceId, inputs }) => ({
                    id,
                    type: type === "generation" ? (resourceId ? "image" : "draft") : type,
                    x,
                    y,
                    text,
                    prompt,
                    draftKind,
                    materialCategory,
                    resourceId,
                    inputs,
                })),
            }),
        onSuccess: (row) => {
            client.setQueryData(queryKey, { submission: row });
            void client.invalidateQueries({ queryKey: ADMIN_REVIEW_COUNTS_QUERY_KEY });
            setOpen(false);
            message.success(row.status === "pending" ? "已提交审核" : "已读取审核结果");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "工作流提交失败，请重试"),
    });

    if (submission) {
        return (
            <Tag className="sp-workflow-submission-status" color={submission.status === "pending" ? "gold" : submission.status === "approved" ? "green" : "red"} title={submission.reviewNote}>
                {shopWorkflowStatusLabel[submission.status]}
                {submission.reviewNote ? ` · ${submission.reviewNote}` : ""}
            </Tag>
        );
    }
    return (
        <>
            <Button icon={<Upload size={15} />} loading={query.isPending} onClick={() => (query.isError ? void query.refetch() : setOpen(true))}>
                {query.isError ? "重试读取审核状态" : "提交审核"}
            </Button>
            <AppModal
                open={open}
                title="提交工作流审核"
                onCancel={() => setOpen(false)}
                onOk={() => form.submit()}
                okText="提交审核"
                cancelText="取消"
                confirmLoading={mutation.isPending}
                closable={!mutation.isPending}
                maskClosable={!mutation.isPending}
                keyboard={!mutation.isPending}
                cancelButtonProps={{ disabled: mutation.isPending }}
            >
                <p className="mb-4">管理员可查看「{workflow.name}」的节点、提示词和所引用的素材。</p>
                <Form form={form} layout="vertical" initialValues={{ category: workflow.category, description: workflow.description }} onFinish={(values) => mutation.mutate(values)}>
                    <Form.Item name="category" label="分类" rules={[{ required: true, message: "请选择工作流分类" }]}>
                        <Select options={SHOP_WORKFLOW_CATEGORIES.map((category) => ({ value: category, label: category }))} placeholder="选择分类" />
                    </Form.Item>
                    <Form.Item name="description" label="简介（选填）">
                        <Input.TextArea rows={3} maxLength={500} placeholder="说明这个工作流的用途" />
                    </Form.Item>
                </Form>
            </AppModal>
        </>
    );
}
