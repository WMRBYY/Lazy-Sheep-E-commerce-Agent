import type { WorkbenchTool } from "@/services/api/workbench";
import { formatBytes } from "@/lib/image-utils";
import type { VideoCapabilityConfig } from "@/lib/model-capabilities";

export const WORKBENCH_MEDIA_KINDS = ["image", "video", "audio"] as const;
export type WorkbenchMediaKind = (typeof WORKBENCH_MEDIA_KINDS)[number];
export type ReferenceLimit = { maxCount: number; maxBytes: number; maxSeconds: number };

export function videoReferenceLimits(profile?: VideoCapabilityConfig): Record<WorkbenchMediaKind, ReferenceLimit> {
    const refs = profile?.references;
    return {
        image: { maxCount: refs?.maxImages ?? 0, maxBytes: refs?.maxImageBytes ?? 0, maxSeconds: 0 },
        video: { maxCount: refs?.maxVideos ?? 0, maxBytes: refs?.maxVideoBytes ?? 0, maxSeconds: refs?.maxVideoDurationSeconds ?? 0 },
        audio: { maxCount: refs?.maxAudios ?? 0, maxBytes: refs?.maxAudioBytes ?? 0, maxSeconds: refs?.maxAudioDurationSeconds ?? 0 },
    };
}

export function referenceMediaIssue(limit: ReferenceLimit, media: { bytes?: number; durationMs?: number }, requireDuration: boolean) {
    if (limit.maxBytes > 0 && (media.bytes ?? 0) > limit.maxBytes) return `大小超过 ${formatBytes(limit.maxBytes)}`;
    if (limit.maxSeconds <= 0) return "";
    if (media.durationMs && media.durationMs > limit.maxSeconds * 1000) return `时长超过 ${limit.maxSeconds} 秒`;
    return requireDuration && !media.durationMs ? "读取不到时长，请换一个可播放的素材" : "";
}

export function workbenchVideoOperation(references: ReadonlyArray<{ kind: string; role?: string }>) {
    if (references.some((reference) => reference.kind === "video" || (reference.kind === "image" && reference.role !== "first_frame" && reference.role !== "last_frame"))) return "reference_to_video";
    if (references.some((reference) => reference.kind === "image")) return "image_to_video";
    if (references.some((reference) => reference.kind === "audio")) return "audio_to_video";
    return "text_to_video";
}

export function workbenchPromptRequired(tool: WorkbenchTool | null) {
    return !tool || tool.inputContract?.promptRequired !== false || (tool.inputContract?.minTextReferences || 0) > 0;
}

export function missingWorkbenchInput(tool: WorkbenchTool | null, references: Array<{ slotKey?: string; resourceId?: string; uploading?: boolean; error?: string }>) {
    return tool?.inputContract?.slots.find((slot) => references.filter((reference) => reference.slotKey === slot.key && reference.resourceId && !reference.uploading && !reference.error).length < Math.max(slot.minCount, slot.required ? 1 : 0));
}
