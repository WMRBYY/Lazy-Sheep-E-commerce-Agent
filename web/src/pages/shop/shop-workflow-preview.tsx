import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "antd";
import { LockKeyhole, Minus, Plus, Copy, RotateCcw, ImageIcon, Workflow as WorkflowIcon } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceStorageKey, resolveResourceVariantUrl, type ResourceAccessVariant } from "@/services/api/resources";
import { commerceConnectionPath } from "./shop-canvas-graph";
import type { ShopWorkflow } from "./shop-canvas-workflows";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import { hasWorkflowArtwork, workflowSampleViewBox, WORKFLOW_ARTWORK_SIZE } from "./shop-workflow-artwork";
import "./shop-workflow-preview.css";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 180;

function workflowBounds(nodes: CanvasLayer[]) {
    if (!nodes.length) return { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
    const x = Math.min(...nodes.map((node) => node.x)) - 24;
    const y = Math.min(...nodes.map((node) => node.y)) - 24;
    return { x, y, width: Math.max(...nodes.map((node) => node.x)) + NODE_WIDTH + 24 - x, height: Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + 24 - y };
}

type MediaUrl = (id: string, variant: ResourceAccessVariant) => string;
const ownMediaUrl: MediaUrl = (id, variant) => resolveResourceVariantUrl(resourceStorageKey(id), variant);
const nodeTitle = (node: CanvasLayer) => node.text?.trim().split("\n")[0] || (node.type === "video" ? "视频素材" : node.type === "text" ? "文本" : "图片素材");

function WorkflowSample({ cover, viewBox, x, y, width, height }: { cover: string; viewBox: string; x?: number; y?: number; width?: number; height?: number }) {
    const id = useId();
    const [clipX, clipY, clipWidth, clipHeight] = viewBox.split(" ").map(Number);
    return (
        <svg className={x === undefined ? "sp-workflow-node-sample" : undefined} x={x} y={y} width={width} height={height} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <defs>
                <pattern id={id} patternUnits="userSpaceOnUse" width={WORKFLOW_ARTWORK_SIZE.width} height={WORKFLOW_ARTWORK_SIZE.height}>
                    <image href={cover} width={WORKFLOW_ARTWORK_SIZE.width} height={WORKFLOW_ARTWORK_SIZE.height} />
                </pattern>
            </defs>
            <rect x={clipX} y={clipY} width={clipWidth} height={clipHeight} fill={`url(#${id})`} />
        </svg>
    );
}

function WorkflowGraphNodeMedia({ workflow, node, mediaUrl, large }: { workflow: ShopWorkflow; node: CanvasLayer; mediaUrl: MediaUrl; large: boolean }) {
    const sample = workflowSampleViewBox(workflow, node);
    const src = node.resourceId && node.type !== "video" ? mediaUrl(node.resourceId, large ? "original" : "thumbnail") : "";
    const [failedSource, setFailedSource] = useState<string>();
    if (sample && workflow.cover) return <WorkflowSample cover={workflow.cover} viewBox={sample} x={8} y={8} width={224} height={130} />;
    if (src && src !== failedSource) return <image href={src} x={8} y={8} width={224} height={130} onError={() => setFailedSource(src)} />;
    return (
        <>
            <circle cx={120} cy={72} r={22} fill="var(--workflow-surface-deep)" />
            <text x={120} y={80} textAnchor="middle" fontSize={24} fill="var(--workflow-muted)">
                {node.type === "text" ? "T" : node.type === "video" ? "▷" : node.draftKind === "upload-card" ? "+" : "◇"}
            </text>
        </>
    );
}

function WorkflowGraph({ workflow, nodes, view, mediaUrl, selectedId, onSelect }: { workflow: ShopWorkflow; nodes: CanvasLayer[]; view: { box: string; scale: number }; mediaUrl: MediaUrl; selectedId?: string; onSelect: (node: CanvasLayer) => void }) {
    const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const labelSize = Math.min(27, Math.max(17, 11 / view.scale));
    const labelLimit = Math.floor((NODE_WIDTH - 18) / labelSize);
    return (
        <svg className="sp-workflow-graph" viewBox={view.box} aria-label={`${workflow.name} 制作链路`}>
            {nodes.flatMap((node) =>
                (node.inputs || []).map((id) => {
                    const source = byId.get(id);
                    return source ? (
                        <path
                            key={`${id}-${node.id}`}
                            d={commerceConnectionPath({ x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 }, { x: node.x, y: node.y + NODE_HEIGHT / 2 })}
                            className="sp-workflow-edge"
                            fill="none"
                            vectorEffect="non-scaling-stroke"
                        />
                    ) : null;
                }),
            )}
            {nodes.map((node) => {
                const title = nodeTitle(node);
                const label = Array.from(title);
                return (
                    <g
                        key={node.id}
                        transform={`translate(${node.x},${node.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`查看节点 ${title}`}
                        aria-pressed={node.id === selectedId}
                        onClick={() => onSelect(node)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelect(node);
                            }
                        }}
                    >
                        <title>{title}</title>
                        <rect className="sp-workflow-node-shell" width={NODE_WIDTH} height={NODE_HEIGHT} rx={14} vectorEffect="non-scaling-stroke" />
                        <WorkflowGraphNodeMedia workflow={workflow} node={node} mediaUrl={mediaUrl} large={view.scale >= 1.4} />
                        <text x={120} y={163} textAnchor="middle" fontSize={labelSize} fill="var(--workflow-ink)">
                            {label.length > labelLimit ? `${label.slice(0, labelLimit - 1).join("")}…` : title}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 5;
const INITIAL_VIEWPORT = { x: 0, y: 0, zoom: 1 };
type PreviewPoint = { x: number; y: number };
type PreviewPointer = { point: PreviewPoint; start: PreviewPoint; target: Element };

function previewPoint(stage: HTMLDivElement, clientX: number, clientY: number): PreviewPoint {
    const { left, top } = stage.getBoundingClientRect();
    return {
        x: clientX - left - stage.clientLeft - stage.clientWidth / 2,
        y: clientY - top - stage.clientTop - stage.clientHeight / 2,
    };
}

function zoomPreviewAt(viewport: typeof INITIAL_VIEWPORT, zoom: number, point: PreviewPoint) {
    const nextZoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, zoom));
    const ratio = nextZoom / viewport.zoom;
    return { x: point.x - (point.x - viewport.x) * ratio, y: point.y - (point.y - viewport.y) * ratio, zoom: nextZoom };
}

function WorkflowInspector({ workflow, selected, mediaUrl }: { workflow: ShopWorkflow; selected: CanvasLayer | null; mediaUrl: MediaUrl }) {
    const [failed, setFailed] = useState(false);
    if (!selected) {
        return (
            <>
                {workflow.cover && !failed ? <img className="sp-workflow-inspector-cover" src={workflow.cover} alt={`${workflow.name} 封面`} onError={() => setFailed(true)} /> : null}
                {workflow.cover && failed ? <p role="status">封面无法读取。</p> : null}
                {workflow.description ? <p>{workflow.description}</p> : null}
                {workflow.requirements?.length ? (
                    <>
                        <strong>准备素材</strong>
                        <ul>
                            {workflow.requirements.map((requirement) => (
                                <li key={requirement}>{requirement}</li>
                            ))}
                        </ul>
                    </>
                ) : null}
                {workflow.limitation ? <p>{workflow.limitation}</p> : null}
                <p className="sp-workflow-hint">拖动移动画布，滚轮或双指缩放。点击节点查看素材和提示词。</p>
            </>
        );
    }
    const sample = workflowSampleViewBox(workflow, selected);
    const video = selected.type === "video";
    const source = selected.resourceId ? mediaUrl(selected.resourceId, video ? "playback" : "original") : "";
    return (
        <>
            <strong>{nodeTitle(selected)}</strong>
            {sample && workflow.cover ? (
                <>
                    <WorkflowSample cover={workflow.cover} viewBox={sample} />
                    <small>示例画面</small>
                </>
            ) : source && !failed ? (
                video ? (
                    <video controls playsInline preload="metadata" src={source} aria-label={nodeTitle(selected)} onError={() => setFailed(true)} />
                ) : (
                    <img className="sp-workflow-node-sample" src={source} alt={nodeTitle(selected)} onError={() => setFailed(true)} />
                )
            ) : failed ? (
                <p role="status">素材无法读取，可能已移除。</p>
            ) : null}
            {selected.prompt ? <p>{selected.prompt}</p> : selected.type === "text" && selected.text ? <p>{selected.text}</p> : null}
            {selected.draftKind === "upload-card" ? <p>在此节点添加参考素材，供相连的生成节点使用。</p> : null}
            <small>{selected.inputs?.length ?? 0} 个上游输入</small>
        </>
    );
}

type PreviewContentProps = {
    workflow: ShopWorkflow;
    onCopy?: () => void;
    busy?: boolean;
    actions?: ReactNode;
    notice?: ReactNode;
    mediaUrl?: MediaUrl;
};

function ShopWorkflowPreviewContent({ workflow, onCopy, busy, actions, notice, mediaUrl = ownMediaUrl }: PreviewContentProps) {
    const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
    const viewportRef = useRef(viewport);
    const stageRef = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, PreviewPointer>());
    const moved = useRef(false);
    const suppressClick = useRef(false);
    const [dragging, setDragging] = useState(false);
    const [selected, setSelected] = useState<CanvasLayer | null>(null);
    const [showCover, setShowCover] = useState(false);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const nodes = useMemo(() => (hasWorkflowArtwork(workflow) ? workflow.nodes.map((node) => ({ ...node, y: node.y * 0.7 })) : workflow.nodes), [workflow]);
    const bounds = useMemo(() => workflowBounds(nodes), [nodes]);
    const fit = Math.min(stageSize.width / bounds.width, stageSize.height / bounds.height, 1);
    const scale = fit * viewport.zoom;
    // Change the SVG viewBox so text and paths are drawn at the current zoom.
    const view =
        scale > 0
            ? {
                  scale,
                  box: `${bounds.x + bounds.width / 2 - (stageSize.width / 2 + viewport.x) / scale} ${bounds.y + bounds.height / 2 - (stageSize.height / 2 + viewport.y) / scale} ${stageSize.width / scale} ${stageSize.height / scale}`,
              }
            : { scale: 1, box: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}` };
    const updateViewport = (next: typeof INITIAL_VIEWPORT) => {
        viewportRef.current = next;
        setViewport(next);
    };
    const zoomFromCenter = (zoom: number) => {
        updateViewport(zoomPreviewAt(viewportRef.current, zoom, { x: 0, y: 0 }));
    };
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const activePointers = pointers.current;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
            updateViewport(zoomPreviewAt(viewportRef.current, viewportRef.current.zoom * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), previewPoint(stage, event.clientX, event.clientY)));
        };
        const measure = () => {
            const width = stage.clientWidth;
            const height = stage.clientHeight;
            if (width > 0 && height > 0) setStageSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
        };
        const observer = new ResizeObserver(measure);
        observer.observe(stage);
        measure();
        stage.addEventListener("wheel", wheel, { passive: false });
        return () => {
            observer.disconnect();
            stage.removeEventListener("wheel", wheel);
            const captured = [...activePointers.entries()];
            activePointers.clear();
            for (const [id, pointer] of captured) if (pointer.target.hasPointerCapture(id)) pointer.target.releasePointerCapture(id);
        };
    }, []);
    const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        const pointer = pointers.current.get(event.pointerId);
        if (!pointer) return;
        pointers.current.delete(event.pointerId);
        if (event.type !== "pointerup") suppressClick.current = true;
        if (pointer.target.hasPointerCapture(event.pointerId)) pointer.target.releasePointerCapture(event.pointerId);
        for (const remaining of pointers.current.values()) remaining.start = remaining.point;
        if (!pointers.current.size) {
            moved.current = false;
            setDragging(false);
        }
    };
    return (
        <section className="sp-workflow-preview" data-canvas-no-zoom>
            <header>
                <span>
                    <LockKeyhole size={14} aria-hidden="true" />
                    只读预览
                </span>
                <div className="sp-workflow-preview-actions">
                    {actions}
                    {workflow.cover ? (
                        <Button icon={showCover ? <WorkflowIcon size={15} /> : <ImageIcon size={15} />} onClick={() => setShowCover(!showCover)}>
                            {showCover ? "返回制作链路" : "查看封面大图"}
                        </Button>
                    ) : null}
                    {onCopy ? (
                        <Button type="primary" icon={<Copy size={15} />} onClick={onCopy} loading={busy}>
                            复制项目
                        </Button>
                    ) : null}
                </div>
            </header>
            {notice}
            <div className="sp-workflow-preview-body">
                <div
                    ref={stageRef}
                    className={`sp-workflow-preview-stage${dragging ? " is-dragging" : ""}`}
                    hidden={showCover}
                    role="region"
                    aria-label="工作流预览画布"
                    tabIndex={0}
                    style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${Math.max(12, 20 * viewport.zoom)}px ${Math.max(12, 20 * viewport.zoom)}px` }}
                    onPointerDown={(event) => {
                        if ((event.button !== 0 && event.button !== 1) || pointers.current.size >= 2) return;
                        event.stopPropagation();
                        if (!pointers.current.size) {
                            moved.current = false;
                            suppressClick.current = false;
                        } else {
                            moved.current = true;
                            suppressClick.current = true;
                            setDragging(true);
                        }
                        const point = previewPoint(event.currentTarget, event.clientX, event.clientY);
                        // Keep capture on the pressed element so a stationary click still reaches its node.
                        const target = event.target as Element;
                        pointers.current.set(event.pointerId, { point, start: point, target });
                        target.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const pointer = pointers.current.get(event.pointerId);
                        if (!pointer) return;
                        event.stopPropagation();
                        const point = previewPoint(event.currentTarget, event.clientX, event.clientY);
                        const previous = pointer.point;
                        const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
                        pointer.point = point;
                        if (other) {
                            const before = { x: (previous.x + other.point.x) / 2, y: (previous.y + other.point.y) / 2 };
                            const after = { x: (point.x + other.point.x) / 2, y: (point.y + other.point.y) / 2 };
                            const distance = Math.hypot(previous.x - other.point.x, previous.y - other.point.y);
                            const nextDistance = Math.hypot(point.x - other.point.x, point.y - other.point.y);
                            const next = zoomPreviewAt(viewportRef.current, viewportRef.current.zoom * (distance > 0 ? nextDistance / distance : 1), before);
                            updateViewport({ ...next, x: next.x + after.x - before.x, y: next.y + after.y - before.y });
                        } else {
                            if (!moved.current && Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) < 4) return;
                            const from = moved.current ? previous : pointer.start;
                            moved.current = true;
                            suppressClick.current = true;
                            setDragging(true);
                            updateViewport({ ...viewportRef.current, x: viewportRef.current.x + point.x - from.x, y: viewportRef.current.y + point.y - from.y });
                        }
                    }}
                    onPointerUp={endPointer}
                    onPointerCancel={endPointer}
                    onLostPointerCapture={endPointer}
                    onClickCapture={(event) => {
                        if (suppressClick.current && event.detail !== 0) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "+" || event.key === "=") zoomFromCenter(viewportRef.current.zoom + 0.25);
                        else if (event.key === "-") zoomFromCenter(viewportRef.current.zoom - 0.25);
                        else if (event.key === "0") updateViewport(INITIAL_VIEWPORT);
                        else if (event.key.startsWith("Arrow")) {
                            const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
                            if (!delta) return;
                            updateViewport({ ...viewportRef.current, x: viewportRef.current.x + delta[0], y: viewportRef.current.y + delta[1] });
                        } else return;
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <WorkflowGraph workflow={workflow} nodes={nodes} view={view} mediaUrl={mediaUrl} selectedId={selected?.id} onSelect={setSelected} />
                </div>
                {showCover && workflow.cover ? (
                    <div className="sp-workflow-cover-large">
                        <img src={workflow.cover} alt={`${workflow.name} 封面大图`} />
                    </div>
                ) : null}
                {!showCover ? (
                    <aside className="sp-workflow-inspector" aria-label="工作流节点详情" data-canvas-wheel-scroll tabIndex={0}>
                        <WorkflowInspector key={selected?.id ?? "workflow"} workflow={workflow} selected={selected} mediaUrl={mediaUrl} />
                    </aside>
                ) : null}
            </div>
            {!showCover ? (
                <footer>
                    <Button size="small" aria-label="缩小预览" title="缩小预览" icon={<Minus size={15} />} disabled={viewport.zoom <= MIN_PREVIEW_ZOOM} onClick={() => zoomFromCenter(viewportRef.current.zoom - 0.25)} />
                    <span>{Math.round(viewport.zoom * 100)}%</span>
                    <Button size="small" aria-label="放大预览" title="放大预览" icon={<Plus size={15} />} disabled={viewport.zoom >= MAX_PREVIEW_ZOOM} onClick={() => zoomFromCenter(viewportRef.current.zoom + 0.25)} />
                    <Button size="small" aria-label="复位预览" title="复位预览" icon={<RotateCcw size={15} />} onClick={() => updateViewport(INITIAL_VIEWPORT)}>
                        适应画布
                    </Button>
                </footer>
            ) : null}
        </section>
    );
}

export function ShopWorkflowPreview({ workflow, title, placeholder, onClose, ...props }: Omit<PreviewContentProps, "workflow"> & { workflow: ShopWorkflow | null; title?: string; placeholder?: ReactNode; onClose: () => void }) {
    return (
        <AppModal open={Boolean(workflow || title)} onCancel={onClose} footer={null} width="min(1440px, 96vw)" style={{ top: 20 }} title={workflow?.name ?? title} rootClassName="sp-workflow-preview-modal">
            {workflow ? <ShopWorkflowPreviewContent key={workflow.id} workflow={workflow} {...props} /> : placeholder}
        </AppModal>
    );
}
