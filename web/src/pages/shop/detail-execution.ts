import { useQuery } from "@tanstack/react-query";

import { imagePromptReferences } from "@/components/ui/reference-prompt-textarea";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { getActiveUserScope } from "@/lib/user-scope";
import { imageSizeLabel } from "@/pages/ecommerce/catalog";
import { activeCommerceReferences } from "@/pages/ecommerce/model-context";
import { commerceInputSignature, plannerPrompt } from "@/pages/ecommerce/planner";
import { assertCommerceImageReferenceCapacity, commerceImageParameters } from "@/pages/ecommerce/workflow";
import { type EcommerceDraft, type EcommercePackageProduct, type EcommercePackageRecognition, type EcommercePackageSlot } from "@/services/api/ecommerce";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type ModelQuoteRequest } from "@/services/api/logical-models";
import { resourceStorageKey } from "@/services/api/resources";
import { createGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

import { retryStoredDetailRequest, sendDetailRequest } from "./detail-outbox";
import { nearestRatio } from "./shop-edits";

const detailMentionPattern = /@(?:商品图|参考图)\d+/g;
export const PACKAGE_PRODUCT_LIMIT = 3;
export const PACKAGE_REFERENCE_LIMIT = 10;
export const PACKAGE_OUTPUT_LIMIT = 20;

export function detailPromptReferences(draft: EcommerceDraft) {
    return [...imagePromptReferences(draft.references, "商品图"), ...imagePromptReferences(draft.layoutReferences || [], "参考图")];
}

export function updateDetailPromptReferences(previous: EcommerceDraft, next: EcommerceDraft) {
    const before = detailPromptReferences(previous);
    const after = detailPromptReferences(next);
    const instruction = next.instruction.replace(detailMentionPattern, (token) => {
        const item = before.find((ref) => `@${ref.label}` === token);
        if (!item) return token;
        const group = item.label.replace(/\d+$/, "");
        const target = after.find((ref) => ref.resourceId === item.resourceId && ref.label.startsWith(group));
        return target ? `@${target.label}` : "";
    });
    return { ...next, instruction };
}

export function packageProduct(draft: EcommerceDraft): EcommercePackageProduct {
    const { productName, category, brand, materials, specifications, packaging, audience, scene, claims, stylePrompt } = draft;
    return { productName, category, brand, materials, specifications, packaging, audience, scene, claims, style: stylePrompt };
}

export function withPackageProduct(draft: EcommerceDraft, product: EcommercePackageProduct): EcommerceDraft {
    const { style, ...fields } = product;
    return { ...draft, ...fields, stylePrompt: style.trim() };
}

export function packageSlots(draft: EcommerceDraft, sizes: string[]): EcommercePackageSlot[] {
    const saved = draft.autoPackage?.slots || [];
    const main = saved.filter((slot) => slot.kind === "main");
    const detail = saved.filter((slot) => slot.kind === "detail");
    const defaultMain = sizes.find((size) => imageSizeLabel(size) === "1:1") || sizes[0];
    const defaultDetail = sizes.find((size) => imageSizeLabel(size) === "3:4") || sizes.find((size) => imageSizeLabel(size) === "2:3") || defaultMain;
    const create = (kind: EcommercePackageSlot["kind"], count: number, values: EcommercePackageSlot[], fallback: string | ((index: number) => string)) =>
        Array.from({ length: count }, (_, index) => ({
            ...values[index],
            kind,
            ratio: sizes.includes(values[index]?.ratio) ? values[index].ratio : typeof fallback === "function" ? fallback(index) : fallback,
        }));

    if (draft.imageType === "main") return create("main", 1, main, defaultMain);
    if (draft.imageType === "detail") {
        const layouts = draft.layoutReferences || [];
        return create("detail", layouts.length, detail, (index) => nearestRatio(layouts[index].width, layouts[index].height, sizes, defaultDetail));
    }
    return [...create("main", saved.length ? main.length : 5, main, defaultMain), ...create("detail", saved.length ? detail.length : 5, detail, defaultDetail)];
}

export function packageReferenceCapacity(config: AiConfig, textModel: string, count: number) {
    if (!textModel) return "电商 Agent 模型配置不可用";
    const maxImages = modelCapabilityConfigFor(config, textModel).text?.references.maxImages || 0;
    return maxImages < count ? `当前 Agent 模型最多读取 ${maxImages} 张图，请减少图片后重试` : "";
}

function detailReferenceImages(draft: EcommerceDraft) {
    return activeCommerceReferences(draft).map((reference) => ({
        id: reference.resourceId,
        name: reference.name || reference.role,
        type: "image/*" as const,
        dataUrl: "" as const,
        storageKey: resourceStorageKey(reference.resourceId),
    }));
}

function detailMentionContext(draft: EcommerceDraft, resourceIds: string[]) {
    const tokens = new Set(draft.instruction.match(detailMentionPattern) || []);
    const mapping = detailPromptReferences(draft)
        .filter((item) => tokens.has(`@${item.label}`))
        .map((item) => ({ label: `@${item.label}`, imageIndex: resourceIds.indexOf(item.resourceId) + 1 }))
        .filter((item) => item.imageIndex > 0);
    return mapping.length ? `\n补充要求中的素材引用对应本次输入图片序号：${JSON.stringify(mapping)}。按每张图片原有的商品图或版式参考角色使用。` : "";
}

export async function submitPackageRecognition(scope: string, id: string, config: AiConfig, source: EcommerceDraft, model: string) {
    const refs = detailReferenceImages(source);
    const problem = packageReferenceCapacity(config, model, refs.length);
    if (problem) throw new Error(problem);
    const prepared = await prepareBackendGenerationTask({
        mode: "text",
        prompt:
            "识别商品图中的商品资料，并按当前自动套餐配置拟定逐张提纲。" +
            detailMentionContext(
                source,
                refs.map((ref) => ref.id),
            ),
        config: { ...config, model },
        streamText: false,
        referenceImages: refs,
        metadata: { source: "ecommerce-agent", stage: "package-recognition", ecommerceDraft: source },
    });
    if (getActiveUserScope() !== scope) throw new Error("账号已切换");
    return createGenerationTask({ ...prepared, clientSubmissionId: id });
}

export function readPackageRecognition(task: GenerationTask, source: EcommerceDraft) {
    const result = JSON.parse(parseBackendGenerationResult(task).text || "null") as EcommercePackageRecognition | null;
    const slots = source.autoPackage?.slots || [];
    if (!result?.product || !Array.isArray(result.outline) || result.outline.length !== slots.length) throw new Error("商品识别结果不完整，请重新识别");
    const product = Object.fromEntries(
        Object.entries(packageProduct(source)).map(([field]) => {
            const value = result.product[field as keyof EcommercePackageProduct];
            return [field, typeof value === "string" ? value : ""];
        }),
    ) as EcommercePackageProduct;
    if (!Object.values(product).some((value) => value.trim())) throw new Error("未识别到商品信息，请更换清晰的商品图后重试");
    const outline = slots.map((slot, index) => {
        const entry = result.outline[index];
        return {
            ...slot,
            title: typeof entry?.title === "string" ? entry.title : "",
            description: typeof entry?.description === "string" ? entry.description : "",
        };
    });
    return { product, outline };
}

function packageTextQuote(config: AiConfig, model: string, refs: number) {
    return systemModelQuoteRequest(config, model, "text", {
        capability: "text",
        input: { textCount: 1, imageCount: refs, referenceImageCount: refs, videoCount: 0, audioCount: 0, characterCount: 0 },
    });
}

export function usePackageQuotes(config: AiConfig, draft: EcommerceDraft, visionModel: string, enabled: boolean) {
    const profile = modelCapabilityConfigFor(config, draft.imageModel).image;
    const refs = activeCommerceReferences(draft).length;
    const ratios = new Map<string, number>();
    for (const slot of draft.autoPackage?.slots || []) ratios.set(slot.ratio, (ratios.get(slot.ratio) || 0) + 1);
    const recognition = packageTextQuote(config, visionModel, refs);
    const planning = packageTextQuote(config, draft.agentModel, refs);
    const image = profile
        ? [...ratios].map(([size, count]) => ({
              count,
              request: systemModelQuoteRequest(config, draft.imageModel, "image", {
                  capability: "image",
                  input: { textCount: 1, imageCount: refs, referenceImageCount: refs, videoCount: 0, audioCount: 0, characterCount: 0 },
                  imageSize: size,
                  options: commerceImageParameters(profile, size, draft.resolution),
              }),
          }))
        : [];
    const recognitionQuote = useQuery({
        queryKey: ["shop-package-quote", recognition],
        queryFn: ({ signal }) => quoteModel(recognition!, signal).then((response) => response.quote.amountMicrocredits / 1_000_000),
        enabled: enabled && refs > 0 && Boolean(recognition),
        staleTime: 30_000,
        retry: false,
    });
    const generationQuote = useQuery({
        queryKey: ["shop-package-generation-quote", planning, image],
        queryFn: async ({ signal }) => {
            const quote = (request: ModelQuoteRequest) => quoteModel(request, signal).then((response) => response.quote.amountMicrocredits);
            const amounts = await Promise.all([quote(planning!), ...image.map(({ count, request }) => quote(request!).then((amount) => count * amount))]);
            return amounts.reduce((sum, amount) => sum + amount, 0) / 1_000_000;
        },
        enabled: enabled && Boolean(planning) && image.length > 0 && image.every(({ request }) => Boolean(request)),
        staleTime: 30_000,
        retry: false,
    });
    return { recognition: recognitionQuote, generation: generationQuote };
}

// The outbox retries with the original request and the same server idempotency key.
export async function submitDetailExecution(scope: string, id: string, config: AiConfig, draft: EcommerceDraft) {
    const pending = await retryStoredDetailRequest(scope, id, true);
    if (pending) return pending;
    const profile = modelCapabilityConfigFor(config, draft.imageModel).image;
    if (!profile) throw new Error("所选图片模型不可用");
    const refs = detailReferenceImages(draft);
    assertCommerceImageReferenceCapacity(refs.length, profile.references.maxImages);
    const problem = packageReferenceCapacity(config, draft.agentModel, refs.length);
    if (problem) throw new Error(problem);
    const logicalModelId = logicalModelIDForConfig({ ...config, model: draft.imageModel });
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未提交创作");
    return sendDetailRequest(scope, {
        id,
        progressive: true,
        draft: { ...draft, execution: undefined, planningTaskId: undefined, directionsTaskId: undefined, creativeDirectionId: undefined, creativeRecommendationId: undefined },
        prompt:
            plannerPrompt(draft) +
            detailMentionContext(
                draft,
                refs.map((ref) => ref.id),
            ),
        inputSignature: commerceInputSignature(draft),
        referenceImages: refs,
        image: {
            kind: "image",
            model: modelOptionName(draft.imageModel),
            ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(config, draft.imageModel).id }),
            parameters: commerceImageParameters(profile, draft.ratio, draft.resolution),
            references: refs.map(({ id: resourceId }) => ({ resourceId, kind: "image", role: "reference" })),
        },
    });
}
