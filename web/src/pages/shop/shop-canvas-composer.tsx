import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Maximize2, Minimize2, X, Sparkles, type LucideIcon } from "lucide-react";
import { Tooltip } from "antd";
import { useState } from "react";
import { canvasOverlayBounds, updateCanvasNodePanelBounds } from "@/lib/canvas/canvas-overlay-layout";

const NODE_GAP = 18;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function ShopCanvasComposer({ open, nodeId, title, icon: Icon = Sparkles, fitNode, onClose, children }: { open: boolean; nodeId?: string; title: string; icon?: LucideIcon; fitNode?: boolean; onClose: () => void; children: ReactNode }) {
    const panel = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    const [expanded, setExpanded] = useState(false);
    useLayoutEffect(() => {
        if (!open || !panel.current) return;
        const element = panel.current;
        const root = element.closest("main")!;
        const canvas = root.querySelector<HTMLElement>("[data-canvas-viewport]");
        const node = nodeId ? root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`) : null;
        let reveal = true;
        let lastPanelSize = "";
        let resizeFrame = 0;
        const layout = () => {
            const rail = root.querySelector(".sp-canvas-rail")?.getBoundingClientRect();
            const top = root.querySelector(".sp-canvas-topbar")?.getBoundingClientRect();
            const toolbar = root.querySelector(".commerce-canvas-toolbar")?.getBoundingClientRect();
            const agent = document.querySelector(".shop-agent-host:not([hidden]) .shop-agent-panel")?.getBoundingClientRect();
            const bounds = canvasOverlayBounds(
                { width: window.innerWidth, height: window.innerHeight },
                { left: window.innerWidth < 650 ? 12 : (rail?.right || 80) + 16, top: (top?.bottom || 90) + 12, right: agent ? agent.left - 12 : window.innerWidth - 12, bottom: (toolbar?.top || window.innerHeight - 65) - 12 },
            );
            const rect = node?.getBoundingClientRect() || { x: window.innerWidth / 2 - 120, y: 110, width: 240, height: 120 };
            const heightBudget = bounds.bottom - bounds.top;
            const widthBudget = bounds.right - bounds.left;
            const stackedHeight = heightBudget - rect.height - NODE_GAP;
            const sideWidth = widthBudget - rect.width - NODE_GAP;
            const sideBySide = Boolean(fitNode && node && stackedHeight < 224 && sideWidth >= 430);
            const stack = Boolean(fitNode && node && !sideBySide && stackedHeight >= 156);
            element.style.maxHeight = `${stack ? stackedHeight : Math.max(160, heightBudget)}px`;
            if (fitNode) element.style.maxWidth = `${sideBySide ? sideWidth : widthBudget}px`;
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            const belowNode = rect.y + rect.height + NODE_GAP;
            let placed = {
                left: clamp(rect.x + (rect.width - width) / 2, bounds.left, bounds.right - width),
                top: clamp(belowNode, bounds.top, bounds.bottom - height),
            };
            // Fit the node and editor together when opening or resizing the panel.
            if (fitNode && node) {
                const panelSize = [width, height, bounds.left, bounds.top, bounds.right, bounds.bottom].join(":");
                const mayReveal = panelSize !== lastPanelSize;
                let dx = 0;
                let dy = 0;
                if (sideBySide) {
                    const xForRight = clamp(rect.x, bounds.left, bounds.right - width - NODE_GAP - rect.width);
                    const xForLeft = clamp(rect.x, bounds.left + width + NODE_GAP, bounds.right - rect.width);
                    const onRight = Math.abs(xForRight - rect.x) <= Math.abs(xForLeft - rect.x);
                    if (mayReveal) dx = (onRight ? xForRight : xForLeft) - rect.x;
                    placed = {
                        left: clamp(rect.x + dx + (onRight ? rect.width + NODE_GAP : -width - NODE_GAP), bounds.left, bounds.right - width),
                        top: clamp(rect.y + (rect.height - height) / 2, bounds.top, bounds.bottom - height),
                    };
                } else if (stack) {
                    const aboveNode = rect.y - height - 30;
                    if (belowNode + height > bounds.bottom) {
                        if (aboveNode >= bounds.top) placed.top = clamp(aboveNode, bounds.top, bounds.bottom - height);
                        else if (mayReveal) {
                            dy = bounds.bottom - height - belowNode;
                            placed.top = bounds.bottom - height;
                        }
                    }
                }
                lastPanelSize = panelSize;
                if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) root.dispatchEvent(new CustomEvent("shop-canvas-reveal", { detail: { dx, dy } }));
                const minimap = root.querySelector(".sp-canvas-minimap")?.getBoundingClientRect();
                if (!sideBySide && minimap && placed.top + height > minimap.top && placed.top < minimap.bottom) {
                    const mapClearance = minimap.left - 12 - width;
                    if (mapClearance >= bounds.left) placed.left = Math.min(placed.left, mapClearance);
                }
            } else if (reveal && node) {
                reveal = false;
                const dy = belowNode + element.offsetHeight > bounds.bottom ? bounds.bottom - belowNode - element.offsetHeight : belowNode < bounds.top ? bounds.top - belowNode : 0;
                if (Math.abs(dy) > 1) root.dispatchEvent(new CustomEvent("shop-canvas-reveal", { detail: { dy } }));
            }
            element.style.left = `${placed.left}px`;
            element.style.top = `${placed.top}px`;
            if (canvas) updateCanvasNodePanelBounds(canvas, element, { left: placed.left, top: placed.top, right: placed.left + element.offsetWidth, bottom: placed.top + element.offsetHeight });
        };
        const resize = new ResizeObserver(layout);
        resize.observe(element);
        if (node) resize.observe(node);
        const observer = new MutationObserver(layout);
        const world = root.querySelector("[data-canvas-world-layer]");
        if (world) observer.observe(world, { attributes: true, attributeFilter: ["style"] });
        if (node) observer.observe(node, { attributes: true, attributeFilter: ["style"] });
        const resizeViewport = () => {
            layout();
            if (!fitNode) return;
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                // The canvas re-centers from its own ResizeObserver before the next frame.
                resizeFrame = requestAnimationFrame(() => {
                    lastPanelSize = "";
                    layout();
                });
            });
        };
        window.addEventListener("resize", resizeViewport);
        layout();
        return () => {
            resize.disconnect();
            observer.disconnect();
            cancelAnimationFrame(resizeFrame);
            window.removeEventListener("resize", resizeViewport);
            if (canvas) updateCanvasNodePanelBounds(canvas, element, null);
        };
    }, [open, nodeId, expanded, fitNode]);
    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    ref={panel}
                    className="sp-canvas-floating-composer"
                    data-expanded={expanded || undefined}
                    data-fit-node={fitNode || undefined}
                    role="region"
                    aria-label="节点生成配置"
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                >
                    <header>
                        <Icon size={16} />
                        <strong>{title}</strong>
                        <span />
                        <Tooltip title={expanded ? "收起输入框" : "展开输入框"}>
                            <button onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "收起输入框" : "展开输入框"}>
                                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </button>
                        </Tooltip>
                        <Tooltip title="关闭配置 · Esc">
                            <button aria-label="关闭生成配置" onClick={onClose}>
                                <X size={16} />
                            </button>
                        </Tooltip>
                    </header>
                    <div className="sp-canvas-floating-composer-body" data-canvas-wheel-scroll>
                        {children}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
