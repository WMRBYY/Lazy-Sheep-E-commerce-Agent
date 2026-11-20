import {
    ArrowDownToLine,
    ArrowUpToLine,
    ChevronDown,
    Clipboard,
    ClipboardCopy,
    Copy,
    CopyPlus,
    Download,
    FlipHorizontal2,
    FlipVertical2,
    Grid2X2,
    ImageUp,
    Link2,
    PanelRightOpen,
    Redo2,
    SquarePlus,
    StickyNote,
    Trash2,
    Type,
    Undo2,
    WandSparkles,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Kbd } from "@/components/ui/base/kbd/kbd";

export type ShopCanvasContextMenuScope = "canvas" | "node" | "selection";

export type ShopCanvasArrangeAction = "grid" | "masonry" | "row" | "column" | "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom" | "distribute-horizontal" | "distribute-vertical";

export interface ShopCanvasContextMenuState {
    scope: ShopCanvasContextMenuScope;
    x: number;
    y: number;
    selectedCount?: number;
    downloadableCount?: number;
    canGenerate?: boolean;
    canPaste?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
}

export interface ShopCanvasContextMenuActions {
    onUpload?: () => void;
    onParseLinkUpload?: () => void;
    onAddNode?: () => void;
    onAddNote?: () => void;
    onAddCopy?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onPaste?: () => void;
    onDownload?: () => void;
    onGenerate?: () => void;
    onArrange?: (action: ShopCanvasArrangeAction) => void;
    onBringToFront?: () => void;
    onSendToBack?: () => void;
    onCopy?: () => void;
    onGroupCopy?: () => void;
    onOpenCreator?: () => void;
    onFlipHorizontal?: () => void;
    onFlipVertical?: () => void;
    onCopyToClipboard?: () => void;
    onDelete?: () => void;
}

export interface ShopCanvasContextMenuProps extends ShopCanvasContextMenuActions {
    menu: ShopCanvasContextMenuState | null;
    onClose: () => void;
}

type MenuItemProps = {
    label: string;
    icon: ReactNode;
    detail?: string;
    shortcut?: string;
    disabled?: boolean;
    danger?: boolean;
    expanded?: boolean;
    onClick?: () => void;
};

function MenuDivider() {
    return <div role="separator" className="sp-canvas-context-divider" />;
}

function MenuItem({ label, icon, detail, shortcut, disabled = false, danger = false, expanded, onClick }: MenuItemProps) {
    return (
        <button type="button" className="sp-canvas-context-item" role="menuitem" disabled={disabled} aria-expanded={expanded} data-danger={danger || undefined} onClick={onClick}>
            <span className="sp-canvas-context-icon" aria-hidden="true">
                {icon}
            </span>
            <span className="sp-canvas-context-label">
                <strong>{label}</strong>
                {detail ? <small>{detail}</small> : null}
            </span>
            {shortcut ? <Kbd className="sp-canvas-keycap">{shortcut}</Kbd> : null}
            {expanded !== undefined ? <ChevronDown className="sp-canvas-context-expand" size={15} aria-hidden="true" /> : null}
        </button>
    );
}

const arrangeItems: Array<{ action: ShopCanvasArrangeAction; label: string }> = [
    { action: "grid", label: "网格排列" },
    { action: "masonry", label: "瀑布流排列" },
    { action: "row", label: "横向排成一行" },
    { action: "column", label: "纵向排成一列" },
    { action: "align-left", label: "左对齐" },
    { action: "align-center", label: "水平居中" },
    { action: "align-right", label: "右对齐" },
    { action: "align-top", label: "顶部对齐" },
    { action: "align-middle", label: "垂直居中" },
    { action: "align-bottom", label: "底部对齐" },
    { action: "distribute-horizontal", label: "水平等距" },
    { action: "distribute-vertical", label: "垂直等距" },
];

/**
 * 电商画布专属上下文菜单。
 *
 * The parent owns the context-menu state and all mutations. This keeps the
 * menu reusable by /shop/canvas without coupling it to the shared creation
 * canvas or its node model.
 */
export function ShopCanvasContextMenu({ menu, onClose, ...actions }: ShopCanvasContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const [position, setPosition] = useState({ x: menu?.x || 0, y: menu?.y || 0 });
    const [arrangeOpen, setArrangeOpen] = useState(false);

    useLayoutEffect(() => {
        if (!menu) return;
        setArrangeOpen(false);
        const element = menuRef.current;
        if (!element) return;
        if (document.activeElement instanceof HTMLElement && !element.contains(document.activeElement)) returnFocus.current = document.activeElement;
        element.focus({ preventScroll: true });
        const place = () => {
            const { width, height } = element.getBoundingClientRect();
            const inset = 12;
            const x = Math.max(inset, Math.min(menu.x, window.innerWidth - width - inset));
            const y = Math.max(inset, Math.min(menu.y, window.innerHeight - height - inset));
            setPosition((current) => (current.x === x && current.y === y ? current : { x, y }));
        };
        const observer = new ResizeObserver(place);
        observer.observe(element);
        window.addEventListener("resize", place);
        place();
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", place);
        };
    }, [menu]);

    useLayoutEffect(() => {
        if (!menu) return;
        const closeOnPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
            onClose();
        };
        window.addEventListener("pointerdown", closeOnPointerDown);
        return () => window.removeEventListener("pointerdown", closeOnPointerDown);
    }, [menu, onClose]);

    if (!menu) return null;

    const run = (callback?: () => void) => {
        if (!callback) return;
        callback();
        onClose();
    };
    const scope = menu.scope;
    const selectedCount = Math.max(1, menu.selectedCount || 1);
    const downloadableCount = Math.max(0, menu.downloadableCount || 0);
    const isSelection = scope === "selection" || (scope === "node" && selectedCount > 1);
    const canArrange = Boolean(actions.onArrange) && isSelection;
    const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            returnFocus.current?.focus({ preventScroll: true });
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:enabled'));
        if (!items.length) return;
        event.preventDefault();
        const current = items.findIndex((item) => item === document.activeElement);
        if (event.key === "Home" || (event.key === "ArrowDown" && current < 0)) items[0].focus();
        else if (event.key === "End" || current < 0) items.at(-1)?.focus();
        else {
            const direction = event.key === "ArrowDown" ? 1 : -1;
            items[(current + direction + items.length) % items.length].focus();
        }
    };

    return (
        <div
            ref={menuRef}
            tabIndex={-1}
            className="sp-canvas-context"
            role="menu"
            aria-label={isSelection ? `已选 ${selectedCount} 个节点的菜单` : "电商画布上下文菜单"}
            data-canvas-context-menu
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            style={{ left: position.x, top: position.y }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={navigate}
            onBlur={(event) => {
                if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onClose();
            }}
        >
            <div style={{ maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>
                {scope === "canvas" ? (
                    <>
                        <div className="sp-canvas-context-heading">画布操作</div>
                        <MenuItem icon={<ImageUp size={16} />} label="上传素材" detail="从本地添加图片或视频" disabled={!actions.onUpload} onClick={() => run(actions.onUpload)} />
                        <MenuItem icon={<Link2 size={16} />} label="解析链接上传" detail="解析商品图片或视频链接" disabled={!actions.onParseLinkUpload} onClick={() => run(actions.onParseLinkUpload)} />
                        <MenuItem icon={<SquarePlus size={16} />} label="添加节点" disabled={!actions.onAddNode} onClick={() => run(actions.onAddNode)} />
                        <MenuItem icon={<StickyNote size={16} />} label="添加注释" detail="记录当前商品视觉想法" disabled={!actions.onAddNote} onClick={() => run(actions.onAddNote)} />
                        <MenuItem icon={<Type size={16} />} label="添加文案" detail="添加标题、卖点或规格说明" disabled={!actions.onAddCopy} onClick={() => run(actions.onAddCopy)} />
                        <MenuDivider />
                        <MenuItem icon={<Undo2 size={16} />} label="撤销" shortcut="Ctrl Z" disabled={!menu.canUndo || !actions.onUndo} onClick={() => run(actions.onUndo)} />
                        <MenuItem icon={<Redo2 size={16} />} label="重做" shortcut="Ctrl Shift Z" disabled={!menu.canRedo || !actions.onRedo} onClick={() => run(actions.onRedo)} />
                        <MenuItem icon={<Clipboard size={16} />} label="粘贴" shortcut="Ctrl V" disabled={!menu.canPaste || !actions.onPaste} onClick={() => run(actions.onPaste)} />
                    </>
                ) : (
                    <>
                        <div className="sp-canvas-context-heading">{isSelection ? `已选 ${selectedCount} 个节点` : "节点操作"}</div>
                        <MenuItem
                            icon={<Download size={16} />}
                            label={downloadableCount ? `下载 ${downloadableCount} 个资源` : "下载资源"}
                            detail={downloadableCount ? "逐个下载选中的电商素材" : "当前选区没有可下载资源"}
                            disabled={!downloadableCount || !actions.onDownload}
                            onClick={() => run(actions.onDownload)}
                        />
                        <MenuItem
                            icon={<WandSparkles size={16} />}
                            label={isSelection ? "批量生成" : "重新生成"}
                            detail={menu.canGenerate === false ? "当前节点缺少生成参数" : "使用电商模式模型生成"}
                            disabled={menu.canGenerate === false || !actions.onGenerate}
                            onClick={() => run(actions.onGenerate)}
                        />
                        <MenuItem icon={<Grid2X2 size={16} />} label="排列方式" detail={canArrange ? "网格、瀑布流、对齐与等距" : "至少选择两个节点"} expanded={arrangeOpen} disabled={!canArrange} onClick={() => setArrangeOpen((open) => !open)} />
                        {arrangeOpen && canArrange ? (
                            <div role="group" aria-label="排列方式" className="sp-canvas-context-arrange">
                                {arrangeItems.map((item) => (
                                    <MenuItem
                                        key={item.action}
                                        icon={<Grid2X2 size={14} />}
                                        label={item.label}
                                        onClick={() => {
                                            actions.onArrange?.(item.action);
                                            onClose();
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                        <MenuDivider />
                        <MenuItem icon={<ArrowUpToLine size={16} />} label="置顶" disabled={!actions.onBringToFront} onClick={() => run(actions.onBringToFront)} />
                        <MenuItem icon={<ArrowDownToLine size={16} />} label="置底" disabled={!actions.onSendToBack} onClick={() => run(actions.onSendToBack)} />
                        <MenuItem icon={<PanelRightOpen size={16} />} label="打开创作面板" detail="带入当前电商节点" disabled={!actions.onOpenCreator} onClick={() => run(actions.onOpenCreator)} />
                        <MenuItem icon={<FlipHorizontal2 size={16} />} label="水平翻转" disabled={!actions.onFlipHorizontal} onClick={() => run(actions.onFlipHorizontal)} />
                        <MenuItem icon={<FlipVertical2 size={16} />} label="垂直翻转" disabled={!actions.onFlipVertical} onClick={() => run(actions.onFlipVertical)} />
                        <MenuItem icon={<Copy size={16} />} label={isSelection ? `复制 ${selectedCount} 个节点` : "复制节点"} shortcut="Ctrl C" disabled={!actions.onCopy} onClick={() => run(actions.onCopy)} />
                        <MenuItem icon={<CopyPlus size={16} />} label="组合复制" disabled={!actions.onGroupCopy} onClick={() => run(actions.onGroupCopy)} />
                        <MenuItem icon={<Clipboard size={16} />} label="粘贴" shortcut="Ctrl V" disabled={!menu.canPaste || !actions.onPaste} onClick={() => run(actions.onPaste)} />
                        <MenuItem icon={<ClipboardCopy size={16} />} label="复制到剪贴板" disabled={!actions.onCopyToClipboard} onClick={() => run(actions.onCopyToClipboard)} />
                        <MenuItem icon={<Trash2 size={16} />} label={isSelection ? `删除 ${selectedCount} 个节点` : "删除节点"} danger disabled={!actions.onDelete} onClick={() => run(actions.onDelete)} />
                    </>
                )}
            </div>
        </div>
    );
}
