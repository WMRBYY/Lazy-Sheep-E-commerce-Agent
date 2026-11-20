import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import type { ShopWorkflow } from "./shop-canvas-workflows";

type Panel = "upper" | "lower" | "hero" | "cover";
type Artwork = {
    split: number;
    row?: number;
    panels: Partial<Record<string, Panel>>;
};

// 原创封面的三个画面按像素分区，详情里的节点共用同一张原图。
export const WORKFLOW_ARTWORK_SIZE = { width: 1672, height: 941 };
const artwork: Record<string, Artwork> = {
    ootd: { split: 646, row: 468, panels: { product: "upper", scene: "lower", model: "hero", reference: "hero" } },
    "garment-scene": { split: 638, panels: { product: "upper", scene: "lower", "scene-1": "lower" } },
    "reference-variants": { split: 559, panels: { product: "lower", model: "upper", "variant-1": "upper" } },
    details: { split: 666, panels: { product: "hero", detail: "lower", "detail-0": "lower", "detail-1": "lower", "detail-2": "upper", "detail-4": "lower" } },
    "taobao-main": { split: 652, row: 449, panels: { product: "upper", model: "hero", lifestyle: "lower" } },
    "product-retouch": { split: 639, panels: { product: "upper", "retouch-2": "lower" } },
    "interior-outfit": { split: 648, panels: { product: "upper", scene: "lower", model: "hero" } },
    "outfit-pose": { split: 628, panels: { product: "upper", "pose-ref": "lower", model: "hero", pose: "lower" } },
    womenswear: { split: 633, row: 434, panels: { product: "upper", model: "hero", views: "cover", video: "lower" } },
    "fashion-suite": { split: 628, panels: { product: "lower", detail: "upper", model: "hero", details: "upper", views: "cover" } },
    "product-views": { split: 593, row: 462, panels: { product: "lower", side: "hero", back: "upper", views: "cover" } },
    "kids-video": { split: 642, panels: { product: "upper", model: "hero", reference: "hero" } },
    "face-video": { split: 627, panels: { person: "lower", reference: "hero" } },
    "person-product-video": { split: 629, panels: { product: "upper", model: "lower", reference: "hero" } },
    "motion-video": { split: 625, panels: { model: "upper", reference: "hero" } },
    "outfit-video": { split: 639, panels: { product: "upper", model: "lower", reference: "hero" } },
    tvc: { split: 627, row: 467, panels: { product: "upper", "shot-1": "lower" } },
    "virtual-model": { split: 642, row: 467, panels: { product: "upper", model: "lower", views: "cover" } },
    main: { split: 627, panels: {} },
    fashion: { split: 642, panels: { views: "cover" } },
    polish: { split: 613, panels: {} },
};

export function workflowCover(id: string, thumbnail = false) {
    return `/commerce-workflows/original/${id}${thumbnail ? "-thumb" : ""}.webp`;
}

export function hasWorkflowArtwork(workflow: ShopWorkflow) {
    return Boolean(workflow.cover && Object.hasOwn(artwork, workflow.id));
}

export function workflowSampleViewBox(workflow: ShopWorkflow, node: CanvasLayer) {
    const sample = artwork[workflow.id];
    if (!workflow.cover || !sample || node.type !== "draft") return undefined;
    const panel = sample.panels[node.id] ?? (node.draftKind === "upload-card" ? undefined : "hero");
    const { width, height } = WORKFLOW_ARTWORK_SIZE;
    const { split, row = 470 } = sample;
    switch (panel) {
        case "upper":
            return `0 0 ${split - 2} ${row - 2}`;
        case "lower":
            return `0 ${row + 2} ${split - 2} ${height - row - 2}`;
        case "hero":
            return `${split + 2} 0 ${width - split - 2} ${height}`;
        case "cover":
            return `0 0 ${width} ${height}`;
    }
}
