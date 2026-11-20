import { Button, Input } from "antd";
import { useEffect, useRef, useState } from "react";
import { CreditStar } from "@/components/ui/credit-star";
import { AppModal } from "@/components/ui/product/app-modal";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCommerceAdminModels, type CommerceAdminModels } from "@/pages/ecommerce/admin-models";
import { prepareDetailProductRecognition, quoteDetailProductRecognition, runDetailProductRecognition, type DetailProductInfo } from "@/services/api/detail-product-recognition";
import type { EcommerceDraft, EcommerceReference } from "@/services/api/ecommerce";
import { ApiError } from "@/services/api/request";
import { isGenerationTaskTerminalError, type CreateTaskInput } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import "./detail-product-info.css";

export type { DetailProductInfo } from "@/services/api/detail-product-recognition";

type ProductField = { key: keyof DetailProductInfo; label: string; example: string; limit?: number };
const groups: ReadonlyArray<{ title: string; fields: readonly ProductField[] }> = [
    {
        title: "这是什么",
        fields: [
            { key: "productName", label: "商品名称", example: "例如：轻奢通勤托特包", limit: 60 },
            { key: "category", label: "商品品类", example: "例如：女包、空气炸锅、坚果", limit: 40 },
            { key: "brand", label: "品牌", example: "例如：原野集。无品牌可留空", limit: 60 },
        ],
    },
    {
        title: "商品本身",
        fields: [
            { key: "materials", label: "材质 / 成分", example: "例如：小牛皮、304 不锈钢" },
            { key: "specifications", label: "规格参数", example: "例如：5 L、1400 W、净含量 250 g" },
            { key: "packaging", label: "包装清单", example: "例如：主机 × 1、炸篮 × 1" },
        ],
    },
    {
        title: "怎么卖",
        fields: [
            { key: "productVisualStyle", label: "视觉风格", example: "例如：米白机身、圆角外壳" },
            { key: "audience", label: "目标人群", example: "例如：通勤人群、学生" },
            { key: "scene", label: "适用场景", example: "例如：通勤、露营、厨房早餐" },
        ],
    },
];
const productKeys = [...groups.flatMap((group) => group.fields.map((field) => field.key)), "claims" as const];
const filledCount = (value: DetailProductInfo) => productKeys.filter((key) => value[key]?.trim()).length;
const credits = (microcredits: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(microcredits / 1_000_000);

function productFields(draft: DetailProductInfo): DetailProductInfo {
    return Object.fromEntries(productKeys.map((key) => [key, draft[key]?.trim() || ""])) as DetailProductInfo;
}

type ProductInfoProps = { draft: EcommerceDraft; config: AiConfig; onChange: (patch: Partial<EcommerceDraft>) => void };

export function DetailProductInfoCard(props: ProductInfoProps) {
    const references = props.draft.references.filter((ref) => ref.role !== "model" && ref.role !== "style" && ref.role !== "competitor");
    const models = useCommerceAdminModels(props.config);
    return <ProductInfo key={JSON.stringify([getActiveUserScope(), references.map((ref) => ref.resourceId)])} {...props} references={references} models={models} />;
}

function ProductInfo({ draft, config, onChange, references, models }: ProductInfoProps & { references: EcommerceReference[]; models: CommerceAdminModels }) {
    const { visionModel, loaded, problem } = models;
    const [quoted, setQuoted] = useState<{ key: string; amount: number; estimated: boolean }>();
    const [quoteError, setQuoteError] = useState("");
    const [quoteRetry, setQuoteRetry] = useState(0);
    const referenceCount = references.length;
    const capacity = visionModel ? modelCapabilityConfigFor(config, visionModel).text?.references.maxImages || 0 : 0;
    const quoteKey = JSON.stringify([visionModel, referenceCount, quoteRetry]);
    const ready = referenceCount > 0 && referenceCount <= Math.min(3, capacity) && Boolean(visionModel);
    useEffect(() => {
        if (!ready) return;
        const controller = new AbortController();
        void quoteDetailProductRecognition({ ...config, model: visionModel }, referenceCount, controller.signal)
            .then(({ quote }) => {
                if (!controller.signal.aborted) {
                    setQuoteError("");
                    setQuoted({ key: quoteKey, amount: quote.amountMicrocredits, estimated: quote.estimated });
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) setQuoteError(quoteKey);
            });
        return () => controller.abort();
    }, [config, ready, referenceCount, visionModel, quoteKey]);

    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<DetailProductInfo>(() => productFields(draft));
    const [thinking, setThinking] = useState(false);
    const [failure, setFailure] = useState("");
    const [complete, setComplete] = useState<{ charge?: number }>();
    const active = useRef<AbortController | null>(null);
    const pending = useRef<CreateTaskInput | null>(null);
    useEffect(() => () => active.current?.abort(), []);
    const quote = quoted?.key === quoteKey ? quoted : undefined;
    const count = filledCount(draft);
    const claims = (draft.claims || "")
        .split(/[\n，,；;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const unavailable = !referenceCount
        ? "上传商品图后可自动识别"
        : referenceCount > 3
          ? "一次最多识别 3 张商品图"
          : !loaded
            ? problem || "正在读取识别模型…"
            : !visionModel
              ? problem || "识别模型暂不可用"
              : referenceCount > capacity
                ? `识别模型最多读取 ${capacity} 张商品图`
                : "";

    async function recognize() {
        if (active.current || !ready || !quote) return;
        const controller = new AbortController();
        active.current = controller;
        const scope = getActiveUserScope();
        const current = () => !controller.signal.aborted && getActiveUserScope() === scope;
        setThinking(true);
        setFailure("");
        try {
            const input = pending.current ?? (await prepareDetailProductRecognition({ ...config, model: visionModel }, references, controller.signal));
            if (!current()) return;
            pending.current = input;
            const result = await runDetailProductRecognition(input, controller.signal);
            if (!current()) return;
            const currentFields = open ? editing : productFields(draft);
            const recognized = productFields(result.info);
            setEditing(Object.fromEntries(productKeys.map((key) => [key, recognized[key] || currentFields[key] || ""])) as DetailProductInfo);
            setComplete({ charge: result.charge });
            setOpen(true);
            pending.current = null;
        } catch (error) {
            if (!current()) return;
            if (isGenerationTaskTerminalError(error) || (error instanceof ApiError && typeof error.status === "number" && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status) && !error.retryable)) {
                pending.current = null;
            }
            setFailure(error instanceof Error ? error.message : "商品信息识别失败，请重试");
        } finally {
            if (current()) {
                active.current = null;
                setThinking(false);
            }
        }
    }

    function showEditor() {
        setFailure("");
        setEditing(productFields(draft));
        setComplete(undefined);
        setOpen(true);
    }

    function save() {
        onChange(productFields(editing));
        setOpen(false);
    }

    function recognizeButton(inEditor: boolean) {
        const waiting = ready && !quote && quoteError !== quoteKey;
        const retryQuote = !quote && quoteError === quoteKey;
        return (
            <Button size="small" disabled={Boolean(unavailable) || waiting} loading={thinking} onClick={() => (retryQuote ? setQuoteRetry((value) => value + 1) : void recognize())}>
                {thinking ? "正在识别…" : retryQuote ? "重试报价" : waiting ? "读取积分…" : pending.current ? "继续识别" : (inEditor && complete) || count ? "重新识别" : "自动识别"}
                {!thinking && quote && (
                    <span className="sdpi-credit">
                        <CreditStar />
                        {quote.estimated ? "约 " : ""}
                        {credits(quote.amount)} 积分
                    </span>
                )}
            </Button>
        );
    }

    return (
        <>
            <section className="sdpi-summary" aria-label="商品信息">
                <div className="sdpi-summary-heading">
                    <strong>商品信息</strong>
                    {count > 0 && <span>已填 {count} 项</span>}
                </div>
                <dl>
                    <dt>商品名</dt>
                    <dd>{draft.productName || "—"}</dd>
                    <dt>品类</dt>
                    <dd>{draft.category || "—"}</dd>
                    <dt>卖点</dt>
                    <dd>{claims.length > 1 ? `${claims[0]} 等 ${claims.length} 条` : claims[0] || "—"}</dd>
                </dl>
                {unavailable && <p className="sdpi-note">{unavailable}</p>}
                {failure && !open && (
                    <p className="sdpi-error" role="alert">
                        {failure}
                    </p>
                )}
                <div className="sdpi-actions">
                    {referenceCount > 0 && recognizeButton(false)}
                    <Button size="small" onClick={showEditor} disabled={thinking}>
                        {count ? "修改" : "手动填写"}
                    </Button>
                </div>
                {thinking && !open && (
                    <span className="sr-only" role="status">
                        Agent 正在读取商品图
                    </span>
                )}
            </section>
            <AppModal
                flush
                centered
                open={open}
                width="min(768px, calc(100vw - 24px))"
                footer={null}
                keyboard={!thinking}
                mask={{ closable: !thinking }}
                closable={!thinking}
                onCancel={() => setOpen(false)}
                className="sdpi-modal"
                classNames={{ header: "sdpi-modal-header" }}
                title={
                    <div>
                        商品信息<p>填写商品事实和卖点，Agent 会用这些内容策划详情图。</p>
                    </div>
                }
            >
                <div className="sdpi-modal-content">
                    <div className="sdpi-modal-form">
                        <div className="sdpi-recognition">
                            <div>
                                <strong>从商品图自动识别</strong>
                                <p className="sdpi-note">{unavailable || "Agent 会读取已上传的商品图，填入可识别的信息。"}</p>
                            </div>
                            {recognizeButton(true)}
                        </div>
                        {thinking && (
                            <p className="sdpi-note" role="status">
                                Agent 正在读取商品图…
                            </p>
                        )}
                        {failure && (
                            <p className="sdpi-error" role="alert">
                                {failure}
                            </p>
                        )}
                        {complete && !thinking && !failure && (
                            <p className="sdpi-success" role="status">
                                识别完成{typeof complete.charge === "number" ? `，本次实扣 ${credits(complete.charge)} 积分` : ""}。请核对并修改识别结果。
                            </p>
                        )}
                        {groups.map((group) => (
                            <fieldset className="sdpi-fields" key={group.title} disabled={thinking}>
                                <legend>{group.title}</legend>
                                {group.fields.map((field) => (
                                    <label key={field.key}>
                                        {field.label}
                                        <Input value={editing[field.key]} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.value })} placeholder={field.example} maxLength={field.limit ?? 220} disabled={thinking} />
                                    </label>
                                ))}
                            </fieldset>
                        ))}
                        <label className="sdpi-claims">
                            卖点
                            <Input.TextArea
                                aria-label="卖点"
                                value={editing.claims}
                                onChange={(event) => setEditing({ ...editing, claims: event.target.value })}
                                placeholder={"每行一条，例如：\n可放 14 英寸笔记本电脑\n包口带拉链"}
                                maxLength={1000}
                                rows={3}
                                disabled={thinking}
                            />
                        </label>
                    </div>
                    <div className="sdpi-modal-footer">
                        <span>
                            已填 {filledCount(editing)} / {productKeys.length} 项
                        </span>
                        <Button type="primary" shape="round" className="sdpi-save" onClick={save} disabled={thinking}>
                            完成
                        </Button>
                    </div>
                </div>
            </AppModal>
        </>
    );
}
