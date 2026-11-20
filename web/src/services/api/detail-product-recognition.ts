import { createClientUUID } from "@/lib/client-id";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "./generation-task";
import { quoteModel } from "./logical-models";
import { resourceStorageKey } from "./resources";
import { createGenerationTask, waitForGenerationTask, type CreateTaskInput } from "./task-center";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { EcommerceDraft, EcommerceReference } from "./ecommerce";

export type DetailProductInfo = Pick<EcommerceDraft, "productName" | "category" | "brand" | "materials" | "specifications" | "packaging" | "productVisualStyle" | "audience" | "scene" | "claims">;

export function quoteDetailProductRecognition(config: AiConfig, count: number, signal: AbortSignal) {
    return quoteModel(
        {
            logicalModelID: logicalModelIDForConfig(config),
            channelId: resolveModelChannel(config, config.model).id,
            modelKey: modelOptionName(config.model),
            intent: { capability: "text", operation: "text", inputs: { image: count } },
        },
        signal,
    );
}

export async function prepareDetailProductRecognition(config: AiConfig, references: EcommerceReference[], signal: AbortSignal) {
    const input = await prepareBackendGenerationTask({
        mode: "text",
        prompt: "从商品图识别商品信息",
        config,
        signal,
        streamText: false,
        referenceImages: references.map((ref) => ({ id: ref.resourceId, name: ref.name || "商品图", type: "image/*", dataUrl: "", storageKey: resourceStorageKey(ref.resourceId) })),
        metadata: { source: "ecommerce-agent", stage: "detail-product-recognition" },
    });
    return { ...input, clientSubmissionId: createClientUUID() };
}

/** Reconnect to the same submission if the network failed after the server accepted it. */
export async function runDetailProductRecognition(input: CreateTaskInput, signal: AbortSignal) {
    const task = await createGenerationTask(input);
    const complete = await waitForGenerationTask(task.id, { initialTask: task, signal });
    const info = JSON.parse(parseBackendGenerationResult(complete).text || "null") as DetailProductInfo | null;
    if (!info?.productName && !info?.category) throw new Error("本次未识别到商品信息，请换一张主体清晰的商品图");
    return { info, charge: complete.billing?.chargedMicrocredits };
}
