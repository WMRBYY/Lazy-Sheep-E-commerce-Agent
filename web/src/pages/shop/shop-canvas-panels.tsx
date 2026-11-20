import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, X, Upload, Images, Workflow, Save, ArrowUpRight, Clock3, Image, Video } from "lucide-react";
import { SHOP_CANVAS_TOOLS, SHOP_CANVAS_CATEGORIES, type ShopCanvasCategory, type ShopCanvasTool } from "./shop-canvas-catalog";
import { readShopWorkflows, saveShopWorkflow, SYSTEM_WORKFLOWS, type ShopWorkflow } from "./shop-canvas-workflows";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import { ShopCanvasNextActions } from "./shop-canvas-next-actions";
import { ShopCanvasTooltip } from "./shop-canvas-tooltip";
type Item = { id: string; label: string; type: string; resourceId?: string };
export function ShopCanvasPanels({
    panel,
    onClose,
    onAdd,
    onUpload,
    onLibrary,
    items,
    onFocus,
    onInsert,
    onSave,
    scope,
    historyItems = [],
    onUseHistory,
    anchor,
    projectName,
    connectionNode,
}: {
    panel: "nodes" | "assets" | "workflows" | "history" | null;
    onClose: () => void;
    onAdd: (tool: ShopCanvasTool) => void;
    onUpload: () => void;
    onLibrary: () => void;
    items: Item[];
    onFocus: (id: string) => void;
    onInsert: (nodes: CanvasLayer[]) => void;
    onSave: () => CanvasLayer[];
    scope: string;
    historyItems?: Item[];
    onUseHistory?: (item: Item) => void;
    anchor?: { x: number; y: number; connection?: { nodeId: string; side: "input" | "output" } };
    projectName: string;
    connectionNode?: { type: string; draftKind?: string };
}) {
    const [category, setCategory] = useState<ShopCanvasCategory>("all"),
        [query, setQuery] = useState(""),
        [active, setActive] = useState(0);
    const [historyFilter, setHistoryFilter] = useState("all"),
        [workflowTab, setWorkflowTab] = useState("system"),
        [templates, setTemplates] = useState<ShopWorkflow[]>([]),
        [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    const panelRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        if (panel !== "nodes" || !anchor || !panelRef.current) return;
        const element = panelRef.current;
        const place = () => {
            element.style.left = `${Math.max(12, Math.min(anchor.x, window.innerWidth - element.offsetWidth - 12))}px`;
            element.style.top = `${Math.max(12, Math.min(anchor.y, window.innerHeight - element.offsetHeight - 12))}px`;
        };
        const observer = new ResizeObserver(place);
        observer.observe(element);
        window.addEventListener("resize", place);
        place();
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", place);
        };
    }, [panel, anchor]);
    const reduced = useReducedMotion();
    const catalog = useRef<HTMLDivElement>(null);
    useEffect(() => {
        catalog.current?.querySelector<HTMLElement>(`button[data-active]`)?.scrollIntoView({ block: "nearest" });
    }, [active]);
    const tools = SHOP_CANVAS_TOOLS.filter((t) => (category === "all" || t.category === category) && (!query || `${t.label} ${t.description}`.includes(query)));
    useEffect(() => {
        setActive(0);
    }, [query, category]);
    useEffect(() => {
        let alive = true;
        void readShopWorkflows(scope)
            .then((value) => {
                if (alive) setTemplates(value);
            })
            .catch(() => {
                if (alive) setError("读取工作流失败，请稍后重试");
            });
        return () => {
            alive = false;
        };
    }, [scope]);
    const save = async () => {
        const nodes = onSave();
        if (!nodes.length) {
            setError("先在画布添加节点，再保存工作流");
            return;
        }
        try {
            const next = await saveShopWorkflow(scope, { id: crypto.randomUUID(), name: projectName || `我的工作流 ${templates.length + 1}`, nodes });
            setTemplates(next);
            setWorkflowTab("personal");
            setError("");
            setSaved(true);
        } catch {
            setError("保存失败，请检查浏览器存储空间");
        }
    };
    const label = panel === "nodes" ? (anchor?.connection ? "下一步动作" : "创建节点") : panel === "assets" ? "我的素材" : panel === "workflows" ? "我的工作流" : "历史记录";
    const sourceItems = panel === "history" ? historyItems : items;
    const filtered = sourceItems.filter((i) => (panel === "assets" ? Boolean(i.resourceId) : historyFilter === "all" || i.type === historyFilter));
    return (
        <AnimatePresence>
            {panel ? (
                <motion.aside
                    ref={panelRef}
                    key={panel}
                    className="sp-canvas-side-panel sp-canvas-library-panel"
                    data-anchored={panel === "nodes" || undefined}
                    data-next-actions={(panel === "nodes" && Boolean(anchor?.connection)) || undefined}
                    aria-label={label}
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    initial={reduced ? false : { opacity: 0, x: -12, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -8, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                >
                    <header className="sp-canvas-library-head">
                        <strong>{label}</strong>
                        <ShopCanvasTooltip title="关闭面板" shortcut="Esc">
                            <button type="button" onClick={onClose} aria-label="关闭面板">
                                <X size={17} />
                            </button>
                        </ShopCanvasTooltip>
                    </header>
                    {panel === "nodes" && anchor?.connection ? (
                        <ShopCanvasNextActions key={anchor.connection.nodeId + anchor.connection.side} kind={connectionNode?.draftKind} type={connectionNode?.type} onAdd={onAdd} />
                    ) : panel === "nodes" ? (
                        <>
                            <label className="sp-canvas-node-search">
                                <Search size={16} />
                                <input
                                    autoFocus
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="搜索节点，如「换背景」"
                                    aria-label="搜索节点"
                                    onKeyDown={(e) => {
                                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                            e.preventDefault();
                                            setActive((v) => (v + (e.key === "ArrowDown" ? 1 : -1) + tools.length) % Math.max(1, tools.length));
                                        }
                                        if (e.key === "Enter" && tools[active] && !tools[active].comingSoon) onAdd(tools[active]);
                                    }}
                                />
                            </label>
                            <div className="sp-canvas-node-categories" role="tablist" aria-label="节点分类">
                                {SHOP_CANVAS_CATEGORIES.map((c) => (
                                    <button role="tab" aria-selected={category === c.key} data-active={category === c.key || undefined} key={c.key} onClick={() => setCategory(c.key)}>
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                            <div ref={catalog} className="sp-canvas-catalog" data-canvas-wheel-scroll>
                                {tools.map((tool, index) => (
                                    <button key={tool.id} type="button" disabled={tool.comingSoon} data-active={active === index || undefined} onFocus={() => setActive(index)} onClick={() => onAdd(tool)}>
                                        <span aria-hidden="true">
                                            <tool.icon size={19} strokeWidth={1.75} />
                                        </span>
                                        <div>
                                            <strong>{tool.label}</strong>
                                            <small>{tool.description}</small>
                                        </div>
                                    </button>
                                ))}
                                {!tools.length ? <p>没有匹配节点，试试其他关键词。</p> : null}
                            </div>
                            <div className="sp-canvas-catalog-hint">
                                <kbd>↑</kbd>
                                <kbd>↓</kbd>选择 <kbd>Enter</kbd>添加到画布
                            </div>
                            <footer>
                                <button onClick={onUpload}>
                                    <Upload size={15} />
                                    上传素材
                                </button>
                                <button onClick={onLibrary}>
                                    <Images size={15} />
                                    从图库选择
                                </button>
                            </footer>
                        </>
                    ) : panel === "workflows" ? (
                        <>
                            <div className="sp-canvas-segments">
                                <button aria-pressed={workflowTab === "personal"} onClick={() => setWorkflowTab("personal")}>
                                    个人
                                </button>
                                <button aria-pressed={workflowTab === "system"} onClick={() => setWorkflowTab("system")}>
                                    系统
                                </button>
                            </div>
                            <div className="sp-canvas-catalog" data-canvas-wheel-scroll>
                                {(workflowTab === "system" ? SYSTEM_WORKFLOWS : templates).map((t) => (
                                    <button key={t.id} onClick={() => onInsert(t.nodes)}>
                                        <span>
                                            <Workflow size={19} />
                                        </span>
                                        <div>
                                            <strong>{t.name}</strong>
                                            <small>{t.nodes.length} 个节点 · 点击加入画布</small>
                                        </div>
                                        <ArrowUpRight size={14} />
                                    </button>
                                ))}
                                {workflowTab === "personal" && !templates.length ? (
                                    <div className="sp-canvas-library-empty">
                                        <Workflow size={28} />
                                        <p>把当前画布保存为你的第一个工作流</p>
                                    </div>
                                ) : null}
                            </div>
                            <footer>
                                <button onClick={() => void save()}>
                                    <Save size={15} />
                                    保存到画布首页
                                </button>
                            </footer>
                            {saved ? (
                                <p className="sp-workflow-save-note" role="status">
                                    已保存到首页「我的工作流」· 仅当前账号的本机浏览器
                                </p>
                            ) : null}
                        </>
                    ) : (
                        <>
                            {panel === "history" ? (
                                <div className="sp-canvas-segments">
                                    {[
                                        ["all", "全部"],
                                        ["image", "图片"],
                                        ["video", "视频"],
                                    ].map(([id, name]) => (
                                        <button key={id} aria-pressed={historyFilter === id} onClick={() => setHistoryFilter(id)}>
                                            {name}（{sourceItems.filter((i) => id === "all" || i.type === id).length}）
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="sp-canvas-segments">
                                    <button aria-pressed>画布素材</button>
                                </div>
                            )}
                            <div className="sp-canvas-catalog" data-canvas-wheel-scroll>
                                {[...filtered].reverse().map((item) => (
                                    <button key={item.id} onClick={() => (panel === "history" ? onUseHistory?.(item) : onFocus(item.id))}>
                                        <span>{item.type === "video" ? <Video size={19} /> : <Image size={19} />}</span>
                                        <div>
                                            <strong>{item.label}</strong>
                                            <small>{panel === "history" ? (item.resourceId ? "点击将成片加入画布" : "成片尚未就绪") : "点击定位到画布"}</small>
                                        </div>
                                    </button>
                                ))}
                                {!filtered.length ? (
                                    <div className="sp-canvas-library-empty">
                                        {panel === "history" ? <Clock3 size={28} /> : <Images size={28} />}
                                        <p>{panel === "history" ? "还没有创作记录" : "画布中还没有素材"}</p>
                                    </div>
                                ) : null}
                            </div>
                            <footer>
                                <button onClick={onUpload}>
                                    <Upload size={15} />
                                    上传素材
                                </button>
                                <button onClick={onLibrary}>
                                    <Images size={15} />
                                    打开素材库
                                </button>
                            </footer>
                        </>
                    )}
                    {error ? <p role="alert">{error}</p> : null}
                </motion.aside>
            ) : null}
        </AnimatePresence>
    );
}
