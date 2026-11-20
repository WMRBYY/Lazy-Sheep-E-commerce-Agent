import { App, Button } from "antd";
import { ChevronRight, LoaderCircle, SlidersHorizontal, Video } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { WorkbenchPage, type WorkbenchComposerParts, type WorkbenchVideoDraft } from "@/pages/workbench/image-workbench-page";
import { FailedTile, ProgressTile, useOnceVisible, WorkbenchGallery, type GalleryActions, type GalleryBatch, type GalleryTile, type WorkbenchGalleryProps } from "@/pages/workbench/workbench-gallery";
import type { WorkbenchOutput } from "@/pages/workbench/workbench-batches";
import { ShopCanvasComposer } from "./shop-canvas-composer";
import { ShopCreationPortal, useRevealShopComposer } from "./shop-creation-dock";
import { useShopScope } from "./shop-context";
import { ShopDropdown } from "./shop-dropdown";
import { favoriteWithNotice, useShopFavorites } from "./shop-edits";
import { groupByDay, stampLabel } from "./shop-items";
import { ShopVideoWorkCard, ShopVideoWorkDetail, videoTileStyle, type ShopVideoMedia } from "./shop-video-work";
import "./shop-video-generation.css";

function videoMedia(batch: GalleryBatch, output: WorkbenchOutput): ShopVideoMedia {
    const seconds = batch.chips.find((value) => value.endsWith(" 秒"));
    const resolution = batch.chips.find((value) => /^\d+p$/i.test(value));
    const task = batch.tasks.find((item) => item.id === output.taskId);
    return {
        ...output,
        label: batch.toolName || task?.prompt.trim().slice(0, 64) || batch.modelLabel || "视频作品",
        createdAt: task?.createdAt || batch.createdAt,
        ratio: batch.ratio,
        durationMs: output.durationMs || (seconds ? Number.parseFloat(seconds) * 1000 : undefined),
        resolution,
    };
}

function VideoHistoryTile({ tile, batch, actions, busyTaskIds, favorites }: { tile: GalleryTile; batch: GalleryBatch; actions: GalleryActions; busyTaskIds: ReadonlySet<string>; favorites: ReadonlySet<string> }) {
    const observe = useOnceVisible<HTMLElement>(() => actions.visible(batch.key));
    if (tile.type === "output") {
        const { output, task } = tile;
        return <ShopVideoWorkCard media={videoMedia(batch, output)} observe={observe} favorite={Boolean(output.resourceId && favorites.has(output.resourceId))} onOpen={() => actions.openOutput(batch, output)} onEdit={() => actions.reuse(batch, task)} />;
    }
    const timestamp = stampLabel("task" in tile ? tile.task.createdAt : batch.createdAt);
    const busy = "task" in tile && busyTaskIds.has(tile.task.id);
    return (
        <article className="svw-status-card" style={videoTileStyle(batch.ratio)} ref={observe}>
            <div className="svw-status-media">
                {tile.type === "active" ? (
                    <ProgressTile tile={tile} actions={actions} busy={busy} />
                ) : tile.type === "failed" ? (
                    <FailedTile task={tile.task} actions={actions} busy={busy} />
                ) : (
                    <div className="svg-tile-placeholder" role="status">
                        {tile.type === "pending" && tile.state === "unsubmitted" ? (
                            <>
                                <span>{tile.error || "提交未完成"}</span>
                                <Button size="small" onClick={() => actions.resume(batch)}>
                                    继续提交
                                </Button>
                            </>
                        ) : (
                            <>
                                <LoaderCircle className="wb-spin" size={20} />
                                <span>{tile.type === "loading" ? "正在载入作品…" : "正在提交…"}</span>
                            </>
                        )}
                    </div>
                )}
            </div>
            <div className="svw-status-caption" title={batch.prompt}>
                {timestamp.slice(-5)}
                {batch.modelLabel ? ` · ${batch.modelLabel}` : ""}
            </div>
        </article>
    );
}

function ShopVideoHistory({ props, favorites }: { props: WorkbenchGalleryProps; favorites: ReadonlySet<string> }) {
    return (
        <WorkbenchGallery
            {...props}
            renderBatches={(batches) => {
                const tiles = batches
                    .flatMap((batch) =>
                        batch.tiles.flatMap((tile) => {
                            const status = tile.type === "output" || tile.type === "loading" ? "done" : tile.type === "failed" || (tile.type === "pending" && tile.state === "unsubmitted") ? "failed" : "active";
                            if (props.filter !== "all" && status !== props.filter) return [];
                            return [{ tile, batch, createdAt: "task" in tile ? tile.task.createdAt : batch.createdAt }];
                        }),
                    )
                    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
                return groupByDay(tiles).map((group) => (
                    <section key={group.key} className="si-group svg-day">
                        <header>
                            <strong>{group.label}</strong>
                            <span className="si-group-count">{group.items.length} 条</span>
                            <i aria-hidden />
                        </header>
                        <div className="svw-day-grid">
                            {group.items.map(({ tile, batch }) => (
                                <VideoHistoryTile key={tile.key} tile={tile} batch={batch} actions={props.actions} busyTaskIds={props.busyTaskIds} favorites={favorites} />
                            ))}
                        </div>
                    </section>
                ));
            }}
        />
    );
}

/** 普通生视频复用工作台的上传、模型能力、报价、提交和任务恢复。 */
export function ShopVideoGeneration({ active, kindPicker, draft, onDraftHandled }: { active: boolean; kindPicker: ReactNode; draft?: WorkbenchVideoDraft; onDraftHandled: () => void }) {
    const revealComposer = useRevealShopComposer();
    const { message } = App.useApp();
    const scope = useShopScope();
    const favorites = useShopFavorites(scope);
    const composer = ({ inputs, referenceFields, settings, footer, modelLabel, specLabel, onPaste }: WorkbenchComposerParts) =>
        active ? (
            <ShopCreationPortal>
                <div className="svg-composer wb-shell" aria-label="视频 AI 输入框" onPasteCapture={onPaste}>
                    <div className="svg-inputs">
                        {inputs}
                        {referenceFields}
                    </div>
                    <div className="svg-toolbar">
                        <div className="svg-controls">
                            {kindPicker}
                            <ShopDropdown
                                placement="top"
                                width={340}
                                panelClassName="svg-settings-popover"
                                ariaLabel="视频模型与参数"
                                icon={<SlidersHorizontal className="size-3.5" />}
                                label={
                                    <>
                                        <span className="svg-model-label">{modelLabel}</span>
                                        <span className="svg-spec-label">{specLabel}</span>
                                    </>
                                }
                            >
                                {() => <div className="svg-settings wb-shell">{settings}</div>}
                            </ShopDropdown>
                        </div>
                        {footer}
                    </div>
                </div>
            </ShopCreationPortal>
        ) : null;
    return (
        <div className="svg-workspace" hidden={!active}>
            <WorkbenchPage
                kind="video"
                renderComposer={composer}
                embeddedVideo={{
                    draft,
                    onDraftHandled,
                    revealComposer,
                    renderGallery: (props) => <ShopVideoHistory props={props} favorites={favorites} />,
                    renderViewer: (detail) => {
                        if (!active || !detail) return <ShopVideoWorkDetail work={null} />;
                        const { batch, output, task, detailFailed, onClose, onDownload, onUseAsReference, onUseFrame, onEdit, onDelete } = detail;
                        const resourceId = output.resourceId;
                        return (
                            <ShopVideoWorkDetail
                                work={{
                                    media: videoMedia(batch, output),
                                    task,
                                    detailState: detailFailed ? "failed" : !task ? "loading" : undefined,
                                    favorite: Boolean(resourceId && favorites.has(resourceId)),
                                    onClose,
                                    onDownload,
                                    onFavorite: resourceId ? () => void favoriteWithNotice(message, scope, resourceId) : undefined,
                                    onReference: resourceId ? onUseAsReference : undefined,
                                    onReferenceImage: onUseFrame,
                                    onEdit,
                                    onDelete,
                                }}
                            />
                        );
                    },
                }}
            />
        </div>
    );
}

function ShopCanvasVideoForm({ inputs, settings, modelPicker, footer, modelLabel, specLabel, onPaste }: WorkbenchComposerParts) {
    const [section, setSection] = useState<"models" | "parameters" | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const navigation = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (section) navigation.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }, [section]);
    const closeSettings = () => {
        setSection(null);
        requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    };
    return (
        <div
            className="svg-composer wb-shell"
            data-canvas-video
            onPasteCapture={section ? undefined : onPaste}
            onKeyDown={(event) => {
                if (event.key !== "Escape" || !section || event.defaultPrevented) return;
                event.preventDefault();
                event.stopPropagation();
                closeSettings();
            }}
        >
            <div className="svg-inputs" hidden={Boolean(section)}>
                {inputs}
            </div>
            <div className="svg-toolbar" hidden={Boolean(section)}>
                <div className="svg-controls">
                    <button ref={trigger} type="button" className="sp-chip" aria-label="视频模型与参数" aria-expanded={Boolean(section)} onClick={() => setSection("models")}>
                        <SlidersHorizontal size={15} aria-hidden="true" />
                        <span className="sp-chip-label">
                            <span className="svg-model-label">{modelLabel}</span>
                            <span className="svg-spec-label">{specLabel}</span>
                        </span>
                        <ChevronRight size={13} aria-hidden="true" />
                    </button>
                </div>
                {footer}
            </div>
            {section ? (
                <div className="svg-canvas-config">
                    <div className="svg-canvas-config-bar">
                        <div ref={navigation} role="group" aria-label="视频配置">
                            <button type="button" aria-pressed={section === "models"} onClick={() => setSection("models")}>
                                模型
                            </button>
                            <button type="button" aria-pressed={section === "parameters"} onClick={() => setSection("parameters")}>
                                参数
                            </button>
                        </div>
                        <button type="button" onClick={closeSettings}>
                            完成
                        </button>
                    </div>
                    <div key={section} className="svg-canvas-config-content" data-canvas-wheel-scroll>
                        {section === "models" ? modelPicker : settings}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function ShopCanvasVideoGeneration({ nodeId, onClose, ...props }: NonNullable<ComponentProps<typeof WorkbenchPage>["canvasVideo"]> & { nodeId: string; onClose: () => void }) {
    return (
        <ShopCanvasComposer open nodeId={nodeId} title="视频生成" icon={Video} fitNode onClose={onClose}>
            <WorkbenchPage kind="video" canvasVideo={props} renderComposer={(parts) => <ShopCanvasVideoForm {...parts} />} />
        </ShopCanvasComposer>
    );
}
