import { App, Button, Dropdown } from "antd";
import { isVideoProvider } from "@vidstack/react";
import { Check, Download, Film, ImagePlus, Mic, Play, SquarePen, Star, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { PassiveVideoPoster } from "@/components/passive-video-poster";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { VideoPlayer } from "@/components/video-player";
import { captureVideoFrames } from "@/lib/canvas/canvas-video-frame";
import { resourceIdFromMediaUrl, workbenchVideoTaskSnapshot, type WorkbenchOutput } from "@/pages/workbench/workbench-batches";
import { resourceFileUrl, resourceStorageKey, resourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import { useUserStore } from "@/stores/use-user-store";
import { stampLabel } from "./shop-items";
import "./shop-video-work.css";

export type ShopVideoMedia = Pick<WorkbenchOutput, "url" | "resourceId" | "posterUrl" | "width" | "height" | "durationMs" | "mimeType"> & {
    label: string;
    createdAt: string;
    ratio?: number;
    resolution?: string;
    hasAudio?: boolean;
};

function videoDuration(ms?: number) {
    if (!ms || ms < 0) return "";
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function videoResolution(media: ShopVideoMedia) {
    if (media.width && media.height) return `${media.width} × ${media.height}`;
    return media.resolution || "";
}

export function videoTileStyle(ratio?: number): CSSProperties {
    return { "--svw-ratio": ratio || 16 / 9 } as CSSProperties;
}

export function ShopVideoWorkCard({
    media,
    favorite,
    selected,
    disabled,
    onOpen,
    onEdit,
    observe,
}: {
    media: ShopVideoMedia;
    favorite?: boolean;
    selected?: boolean;
    disabled?: boolean;
    onOpen: () => void;
    onEdit?: () => void;
    observe?: Ref<HTMLElement>;
}) {
    const ratio = media.width && media.height ? media.width / media.height : media.ratio;
    const duration = videoDuration(media.durationMs);
    const resolution = videoResolution(media);
    const timestamp = stampLabel(media.createdAt);
    const poster = media.resourceId && resourceIdFromMediaUrl(media.posterUrl) === media.resourceId ? undefined : media.posterUrl;
    return (
        <article ref={observe} className="svw-card" style={videoTileStyle(ratio)}>
            <button type="button" className="svw-cover" aria-label={`${selected === undefined ? "预览" : "选择"}${media.label}`} aria-haspopup={selected === undefined ? "dialog" : undefined} aria-pressed={selected} disabled={disabled} onClick={onOpen}>
                <PassiveVideoPoster src={media.url} poster={poster} storageKey={media.resourceId ? resourceStorageKey(media.resourceId) : undefined} alt="" className="svw-poster" fallback={<Film className="svw-poster-fallback" aria-hidden />} />
                {selected === undefined ? (
                    <span className="svw-play" aria-hidden>
                        <Play size={18} fill="currentColor" />
                    </span>
                ) : (
                    <span className="sw2-check" data-on={selected || undefined}>
                        {selected ? <Check size={13} /> : null}
                    </span>
                )}
                {duration ? <span className="svw-timecode">{duration}</span> : null}
            </button>
            <div className="svw-caption">
                <div className="svw-caption-text">
                    <strong title={media.label}>{media.label}</strong>
                    <div className="svw-meta">
                        {timestamp ? (
                            <time dateTime={media.createdAt} title={timestamp}>
                                {timestamp.slice(-5)}
                            </time>
                        ) : null}
                        {resolution ? <span>{resolution}</span> : null}
                        {favorite ? <Star size={12} fill="currentColor" aria-label="已收藏" /> : null}
                    </div>
                </div>
                {onEdit && selected === undefined ? (
                    <AntTooltip title="重新编辑">
                        <Button type="text" size="small" icon={<SquarePen size={15} />} aria-label="重新编辑" onClick={onEdit} />
                    </AntTooltip>
                ) : null}
            </div>
        </article>
    );
}

type ShopVideoWorkDetailProps = {
    media: ShopVideoMedia;
    task?: GenerationTask;
    detailState?: "loading" | "failed";
    favorite?: boolean;
    onClose: () => void;
    onDownload: () => void;
    onFavorite?: () => void;
    onReference?: () => void;
    onReferenceImage?: (resourceId: string) => void;
    onEdit?: () => void;
    onDelete: () => void;
};

export function ShopVideoWorkDetail({ work }: { work: ShopVideoWorkDetailProps | null }) {
    const lastWork = useRef<ShopVideoWorkDetailProps | null>(null);
    useLayoutEffect(() => {
        if (work) lastWork.current = work;
    }, [work]);
    const shown = work ?? lastWork.current;
    if (!shown) return null;
    return <ShopVideoWorkModal key={shown.media.resourceId || shown.media.url} {...shown} open={Boolean(work)} />;
}

function ShopVideoWorkModal({ media, task, detailState, favorite, onClose, onDownload, onFavorite, onReference, onReferenceImage, onEdit, onDelete, open }: ShopVideoWorkDetailProps & { open: boolean }) {
    const { message } = App.useApp();
    const [playback, setPlayback] = useState({ attempt: 0, failed: false });
    const [measuredMedia, setMeasuredMedia] = useState<{ width: number; height: number; durationMs?: number }>();
    const [capturing, setCapturing] = useState(false);
    const stage = useRef<HTMLDivElement>(null);
    const frameCapture = useRef<AbortController | null>(null);
    useEffect(() => () => frameCapture.current?.abort(), [open]);

    const useCurrentFrame = async () => {
        const video = stage.current?.querySelector("video");
        const userId = useUserStore.getState().user?.id;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !userId || !onReferenceImage) {
            message.warning("视频画面尚未载入，请等待播放后再试");
            return;
        }
        if (frameCapture.current) return;
        const controller = new AbortController();
        frameCapture.current = controller;
        setCapturing(true);
        try {
            const {
                frames: [frame],
            } = await captureVideoFrames(media.url, [video.currentTime * 1000]);
            controller.signal.throwIfAborted();
            const resource = await uploadResourceFile(frame.blob, "image", { fileName: `视频画面-${Math.round(frame.timeMs)}.png`, width: frame.width, height: frame.height, expectedUserId: userId, signal: controller.signal });
            if (!controller.signal.aborted && useUserStore.getState().user?.id === userId) onReferenceImage(resource.id);
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "视频画面读取失败，请重试");
        } finally {
            frameCapture.current = null;
            setCapturing(false);
        }
    };
    const snapshot = task ? workbenchVideoTaskSnapshot(task) : null;
    const refs = snapshot?.references ?? [];
    const duration = videoDuration(measuredMedia?.durationMs || media.durationMs || Number(snapshot?.parameters.seconds || 0) * 1000);
    const resolution = videoResolution(measuredMedia ? { ...media, ...measuredMedia } : media);
    const actions = [
        { label: "删除", icon: Trash2, onClick: onDelete },
        { label: "下载", icon: Download, onClick: onDownload },
        { label: favorite ? "取消收藏" : "收藏", icon: Star, onClick: onFavorite, pressed: favorite },
    ];
    return (
        <AppModal
            flush
            open={open}
            centered
            title={<span className="sr-only">视频作品预览</span>}
            footer={null}
            closable={false}
            width="min(1180px, calc(100vw - 32px))"
            className="ms-scope"
            styles={{ header: { display: "none" } }}
            onCancel={onClose}
            afterClose={() => setPlayback({ attempt: 0, failed: false })}
        >
            <div className="svw-viewer">
                <div className="svw-stage" ref={stage}>
                    {playback.failed ? (
                        <div className="svw-playback-error" role="alert">
                            <Film size={24} />
                            <span>视频暂时无法播放</span>
                            <Button onClick={() => setPlayback(({ attempt }) => ({ attempt: attempt + 1, failed: false }))} size="small">
                                重新加载
                            </Button>
                        </div>
                    ) : open ? (
                        <VideoPlayer
                            key={playback.attempt}
                            src={media.url}
                            mimeType={media.mimeType}
                            hasAudio={media.hasAudio}
                            title={media.label}
                            autoPlay
                            startMuted
                            className="svw-player"
                            onError={() => setPlayback((state) => ({ ...state, failed: true }))}
                            onCanPlay={({ provider, duration }) => {
                                const video = isVideoProvider(provider) ? provider.media : null;
                                if (video instanceof HTMLVideoElement && video.videoWidth && video.videoHeight)
                                    setMeasuredMedia({ width: video.videoWidth, height: video.videoHeight, durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : undefined });
                            }}
                        />
                    ) : null}
                    <div className="svw-actions" aria-label="视频作品操作" role="group">
                        {actions
                            .filter(({ onClick }) => onClick)
                            .map(({ label, icon: Icon, onClick, pressed }) => (
                                <AntTooltip key={Icon.displayName || label} title={label} placement="right">
                                    <Button type="text" className="svw-action" data-icon-only icon={<Icon size={16} fill={pressed ? "currentColor" : "none"} />} aria-label={label} aria-pressed={pressed} onClick={onClick} />
                                </AntTooltip>
                            ))}
                        {onReference || onReferenceImage ? (
                            <Dropdown
                                trigger={["click"]}
                                onOpenChange={(show) => {
                                    if (show) stage.current?.querySelector("video")?.pause();
                                }}
                                menu={{
                                    items: [
                                        { key: "image", label: "当前帧用作参考图", disabled: !onReferenceImage },
                                        { key: "video", label: "用作参考视频", disabled: !onReference },
                                    ],
                                    onClick: ({ key }) => {
                                        if (key === "image") void useCurrentFrame();
                                        else onReference?.();
                                    },
                                }}
                            >
                                <Button type="text" className="svw-action" data-icon-only loading={capturing} icon={<ImagePlus size={16} />} aria-label="用作参考" title="用作参考" />
                            </Dropdown>
                        ) : null}
                        {onEdit ? (
                            <AntTooltip title="重新编辑" placement="right">
                                <Button type="text" className="svw-action" data-icon-only icon={<SquarePen size={16} />} aria-label="重新编辑" onClick={onEdit} />
                            </AntTooltip>
                        ) : null}
                    </div>
                </div>
                <aside className="svw-info" aria-label="视频参数与参考素材">
                    <header className="svw-info-header">
                        <div>
                            <h2 title={media.label}>{media.label}</h2>
                            <time dateTime={media.createdAt}>{stampLabel(media.createdAt)}</time>
                        </div>
                        <AntTooltip title="关闭预览">
                            <Button type="text" autoFocus icon={<X size={18} />} aria-label="关闭预览" onClick={onClose} />
                        </AntTooltip>
                    </header>
                    <div className="svw-detail-scroll">
                        <div className="svw-specs">
                            {duration ? <span>{duration}</span> : null}
                            {resolution ? <span>{resolution}</span> : null}
                            {task?.model ? <span>{task.model}</span> : null}
                        </div>
                        <section className="svw-detail-block" aria-label="参考素材">
                            <h3>参考素材 {refs.length ? <small>{refs.length}</small> : null}</h3>
                            {detailState ? (
                                <p role={detailState === "failed" ? "alert" : "status"}>{detailState === "loading" ? "正在读取素材…" : "参考素材读取失败，关闭预览后可重试"}</p>
                            ) : refs.length ? (
                                <div className="svw-references">
                                    {refs.map((ref, index) => {
                                        const label = ref.role === "first_frame" ? "首帧" : ref.role === "last_frame" ? "尾帧" : ref.kind === "image" ? "图片" : ref.kind === "video" ? "视频" : "音频";
                                        const storageKey = resourceStorageKey(ref.resourceId);
                                        return (
                                            <div className="svw-reference" key={`${ref.resourceId}:${index}`}>
                                                {ref.kind === "image" ? (
                                                    <CachedResourceImage
                                                        storageKey={storageKey}
                                                        src={resourceVariantUrl(ref.resourceId, "thumbnail")}
                                                        alt={label}
                                                        variant="thumbnail"
                                                        loading="lazy"
                                                        fallback={<Film aria-label="参考图无法读取" size={18} />}
                                                    />
                                                ) : ref.kind === "video" ? (
                                                    <PassiveVideoPoster src={resourceFileUrl(ref.resourceId)} storageKey={storageKey} alt="参考视频" className="svw-reference-video" />
                                                ) : (
                                                    <Mic aria-hidden size={20} />
                                                )}
                                                <span>{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p>这条作品没有参考素材</p>
                            )}
                        </section>
                        {task?.prompt ? (
                            <section className="svw-detail-block" aria-label="提示词">
                                <h3>提示词</h3>
                                <p className="svw-detail-prompt">{task.prompt}</p>
                            </section>
                        ) : null}
                    </div>
                </aside>
            </div>
        </AppModal>
    );
}
