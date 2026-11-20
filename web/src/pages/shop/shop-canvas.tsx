// Copyright (c) 2026 meiyeai and upstream contributors. Licensed under MIT.
import { App, Input } from "antd";
import { ArrowLeft, CircleHelp, Clapperboard, FolderOpen, Headset, History, Image, Pencil, Plus, ShoppingBag, Workflow, type LucideIcon } from "lucide-react";
import { WorkspaceTopBar } from "@/components/layout/workspace-top-bar";
import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { ShopCanvasPanels } from "./shop-canvas-panels";
import { ShopCanvasComposer } from "./shop-canvas-composer";
import { SHOP_CANVAS_TOOLS, SHOP_CANVAS_IMAGE_PROMPTS } from "./shop-canvas-catalog";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import { commerceNodeReferences, reconcileCommerceLinks, shopCanvasVideoInputs, type CommerceGraphNode } from "./shop-canvas-graph";
import { tryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { FeedbackModal } from "@/components/feedback/feedback-modal";
import { defaultTryOnDraft, type TryOnDraft } from "@/pages/ecommerce/tryon/tryon-plan";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { readShopCanvasProjects, saveShopCanvasProjects } from "./shop-canvas-projects";

import { EcommerceResultCanvas, type EcommerceCanvasContextTarget, type EcommerceCanvasLayerCommandRequest, type EcommerceCanvasLayerSelectionRequest } from "@/pages/ecommerce/result-canvas";
import { ShopCanvasContextMenu, type ShopCanvasArrangeAction, type ShopCanvasContextMenuState } from "./shop-canvas-context-menu";
import { AppModal } from "@/components/ui/product/app-modal";
import { importResourceFromUrl, resourceStorageKey } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import { useTryOn } from "@/pages/ecommerce/tryon/use-tryon";
import { isTryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { ShopComposer } from "./shop-composer";
import { SHOP_MARKET, useShopFunction, useShopScope } from "./shop-context";
import { addChatResources, updateChatDraft, useChatDraft, useShopEdits, type ChatDraft } from "./shop-edits";
import { useShopItems } from "./shop-items";
import { startEcommerceDownload } from "@/pages/ecommerce/export";
import type { EcommercePlanImage } from "@/services/api/ecommerce";
import { downloadBrowserMedia } from "@/services/browser-download";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchCanvasVideoDraft, WorkbenchCanvasVideoInputs } from "@/pages/workbench/image-workbench-page";
import { createClientUUID } from "@/lib/client-id";

import "@/pages/ecommerce/agent-theme.css";
import "@/pages/ecommerce/interaction.css";
import "@/pages/ecommerce/studio.css";
import "./shop-canvas.css";
import "./shop-canvas-workspace.css";
import "@/themes/yunhe-xianguan/fonts.css";
import "@/themes/longying-ink/fonts.css";

type RailKey = "nodes" | "workflows" | "assets" | "history";
type LinkImportKind = "image" | "video";
type ImageNodeDraft = { image: TryOnDraft; chat: ChatDraft; links: string };
type ShopNodeDraft = ImageNodeDraft | { videoGeneration: WorkbenchCanvasVideoDraft };
type VideoGenerationNode = { id: string; draft?: WorkbenchCanvasVideoDraft; inputs: WorkbenchCanvasVideoInputs };
const ShopCanvasVideoGeneration = lazy(() => import("./shop-video-generation").then((module) => ({ default: module.ShopCanvasVideoGeneration })));
const NODE_ITEMS = SHOP_CANVAS_TOOLS;
const LINK_KINDS = [
    { value: "image" as const, label: "图片链接", icon: <Image size={16} /> },
    { value: "video" as const, label: "视频链接", icon: <Clapperboard size={16} /> },
];

const RAIL_ITEMS: Array<{ key: RailKey; label: string; icon: LucideIcon }> = [
    { key: "nodes", label: "添加节点", icon: Plus },
    { key: "workflows", label: "工作流", icon: Workflow },
    { key: "assets", label: "素材", icon: FolderOpen },
    { key: "history", label: "历史", icon: History },
];

/** 电商专属画布。它只复用电商结果画布，独立挂在 /shop/canvas，不进入通用 /canvas/:id。 */
export default function ShopCanvas() {
    const navigate = useNavigate();
    const { projectId } = useParams();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const userId = user?.id || "guest";
    const scope = useShopScope();
    const { fn, mode, allowed, pick } = useShopFunction();
    const imageState = useTryOn({ scope, fn, market: SHOP_MARKET });
    const edits = useShopEdits(scope);
    const generationItems = useShopItems(imageState, edits.records, edits.tasks);
    const generations = useMemo(
        () => generationItems.map((item) => ({ key: item.key, status: item.status, resourceId: item.resourceId, label: item.label, stage: item.stage, error: item.error, progress: item.progress, createdAt: item.createdAt })),
        [generationItems],
    );
    const [composerOpen, setComposerOpen] = useState(false);
    const [generationRequest, setGenerationRequest] = useState<{ keys: string[]; nonce: number; targetId?: string }>();
    const [draftRequest, setDraftRequest] = useState<{ kind: string; label: string; nonce: number; position?: { x: number; y: number }; connection?: { nodeId: string; side: "input" | "output" } }>();
    const [nodeAnchor, setNodeAnchor] = useState<{ x: number; y: number; connection?: { nodeId: string; side: "input" | "output" } }>();
    const [activeDraftId, setActiveDraftId] = useState<string>();
    const [videoGenerationNode, setVideoGenerationNode] = useState<VideoGenerationNode | null>(null);
    const [videoTaskReceipts, setVideoTaskReceipts] = useState<Record<string, string>>({});
    const [submittingVideoNodes, setSubmittingVideoNodes] = useState<ReadonlySet<string>>(() => new Set());
    const videoSubmissions = useRef(new Map<string, { id: string; key: string; inFlight: boolean }>());
    const handleLayerSelection = useCallback((ids: string[]) => {
        setSelectedLayerIds(ids);
        if (!ids.length) {
            setComposerOpen(false);
            setVideoGenerationNode(null);
        }
    }, []);
    const [updateNodeRequest, setUpdateNodeRequest] = useState<{ id: string; patch: Partial<CanvasLayer>; nonce: number }>();
    const chatDraft = useChatDraft();
    const nodeDrafts = useRef(new Map<string, ShopNodeDraft>());
    const activeLinks = useRef("");
    const [draftsReady, setDraftsReady] = useState(false);
    const draftWrites = useRef<Promise<unknown>>(Promise.resolve());
    const draftStorageKey = `shop-canvas-drafts:${projectId}`;
    const currentCanvas = useRef({ scope, draftStorageKey });
    currentCanvas.current = { scope, draftStorageKey };
    useEffect(() => {
        let alive = true;
        setDraftsReady(false);
        setVideoGenerationNode(null);
        setVideoTaskReceipts({});
        setSubmittingVideoNodes(new Set());
        videoSubmissions.current = new Map();
        nodeDrafts.current = new Map();
        void Promise.resolve(localForageStorageForScope(scope).getItem(draftStorageKey))
            .then((raw) => {
                if (!alive) return;
                const entries = raw ? JSON.parse(String(raw)) : [];
                if (Array.isArray(entries)) nodeDrafts.current = new Map(entries);
                setDraftsReady(true);
            })
            .catch(() => {
                if (alive) message.error("节点配置读取失败，请刷新后重试");
            });
        return () => {
            alive = false;
        };
    }, [scope, draftStorageKey]);
    const writeNodeDraft = useCallback(
        (id: string, draft: ShopNodeDraft) => {
            if (!draftsReady) return;
            nodeDrafts.current.set(id, draft);
            const value = JSON.stringify([...nodeDrafts.current]);
            draftWrites.current = draftWrites.current
                .catch(() => undefined)
                .then(() => localForageStorageForScope(scope).setItem(draftStorageKey, value))
                .catch(() => message.error({ content: "节点配置未能保存，请检查本机存储空间", key: "shop-node-save" }));
        },
        [draftsReady, draftStorageKey, message, scope],
    );
    const saveNodeDraft = (id: string) => writeNodeDraft(id, { image: imageState.draft, chat: chatDraft, links: activeLinks.current });
    const videoGenerationNodeId = videoGenerationNode?.id;
    const saveVideoGenerationDraft = useCallback(
        (draft: WorkbenchCanvasVideoDraft) => {
            if (videoGenerationNodeId) writeNodeDraft(videoGenerationNodeId, { videoGeneration: draft });
        },
        [videoGenerationNodeId, writeNodeDraft],
    );
    const submitCanvasVideo = async (requestKey: string, createTask: (id: string) => Promise<GenerationTask>) => {
        if (!videoGenerationNodeId) return;
        const nodeId = videoGenerationNodeId;
        const submissions = videoSubmissions.current;
        const previous = submissions.get(nodeId);
        if (previous?.inFlight) return;
        const id = previous?.key === requestKey ? previous.id : createClientUUID();
        const submission = { id, key: requestKey, inFlight: true };
        submissions.set(nodeId, submission);
        setSubmittingVideoNodes((current) => new Set(current).add(nodeId));
        const isCurrentCanvas = () => videoSubmissions.current === submissions && currentCanvas.current.scope === scope && currentCanvas.current.draftStorageKey === draftStorageKey;
        try {
            const task = await createTask(id);
            if (!isCurrentCanvas()) return;
            submissions.delete(nodeId);
            setVideoTaskReceipts((current) => ({ ...current, [nodeId]: task.id }));
            setVideoGenerationNode((current) => (current?.id === nodeId ? null : current));
            message.success("视频任务已提交");
        } finally {
            submission.inFlight = false;
            if (isCurrentCanvas()) setSubmittingVideoNodes((current) => new Set([...current].filter((item) => item !== nodeId)));
        }
    };
    const [supportOpen, setSupportOpen] = useState(false);
    const titleStorageUser = useRef(userId);
    const [activeRail, setActiveRail] = useState<RailKey | null>(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [helpTab, setHelpTab] = useState<"tutorial" | "shortcuts" | null>(null);
    const [workflowRequest, setWorkflowRequest] = useState<{ nodes: CanvasLayer[]; nonce: number }>();
    const snapshot = useRef<CanvasLayer[]>([]);
    const onSnapshotChange = useCallback((nodes: CanvasLayer[]) => {
        snapshot.current = nodes;
        setVideoGenerationNode((current) => {
            if (!current) return current;
            const node = nodes.find((item) => item.id === current.id);
            if (!node || node.type !== "draft") return null;
            const inputs = shopCanvasVideoInputs(nodes, current.id);
            return JSON.stringify(current.inputs) === JSON.stringify(inputs) ? current : { ...current, inputs };
        });
    }, []);
    const [pendingReferences, setPendingReferences] = useState<{ kind: string; references: CommerceGraphNode[] } | null>(null);
    const [uploadRequest, setUploadRequest] = useState<number>();
    const [toolRequest, setToolRequest] = useState<{
        tool: "select" | "hand" | "text";
        nonce: number;
        text?: string;
        fontFamily?: string;
        fontSize?: number;
        color?: string;
        position?: { x: number; y: number };
        connection?: { nodeId: string; side: "input" | "output" };
        annotation?: boolean;
    }>();
    const [focusLayerRequest, setFocusLayerRequest] = useState<{
        id: string;
        nonce: number;
    }>();
    const [historyRequest, setHistoryRequest] = useState<{
        action: "undo" | "redo";
        nonce: number;
    }>();
    const [resourceRequest, setResourceRequest] = useState<{
        resourceId: string;
        kind?: "image" | "video";
        nonce: number;
    }>();
    const [canvasTitle, setCanvasTitle] = useState(() => {
        try {
            return readShopCanvasProjects(userId).find((item) => item.id === projectId)?.name || "未命名画布";
        } catch {
            return "未命名画布";
        }
    });
    const [titleReady, setTitleReady] = useState(false);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState(canvasTitle);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkKind, setLinkKind] = useState<LinkImportKind>("image");
    const [linkDialogUrl, setLinkDialogUrl] = useState("");
    const [linkDialogError, setLinkDialogError] = useState("");
    const [linkDialogBusy, setLinkDialogBusy] = useState(false);
    const [historyState, setHistoryState] = useState({
        canUndo: false,
        canRedo: false,
        pastCount: 0,
    });
    const [contextMenu, setContextMenu] = useState<ShopCanvasContextMenuState | null>(null);
    const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
    const [selectLayersRequest, setSelectLayersRequest] = useState<EcommerceCanvasLayerSelectionRequest>();
    const [layerCommandRequest, setLayerCommandRequest] = useState<EcommerceCanvasLayerCommandRequest>();
    const clipboardIds = useRef<string[]>([]);
    const [canvasItems, setCanvasItems] = useState<
        Array<{
            id: string;
            type: "image" | "video" | "text" | "generation" | "draft";
            label: string;
            resourceId?: string;
            draftKind?: string;
        }>
    >([]);
    const handleCanvasItemsChange = useCallback((items: typeof canvasItems) => {
        setCanvasItems((current) =>
            current.length === items.length &&
            current.every((item, index) => item.id === items[index].id && item.type === items[index].type && item.label === items[index].label && item.resourceId === items[index].resourceId && item.draftKind === items[index].draftKind)
                ? current
                : items,
        );
    }, []);
    useEffect(() => {
        if (!titleReady || titleStorageUser.current !== userId) return;
        try {
            const projects = readShopCanvasProjects(userId);
            saveShopCanvasProjects(
                userId,
                projects.map((item) => (item.id === projectId ? { ...item, name: canvasTitle.trim() || "未命名画布", updatedAt: new Date().toISOString() } : item)),
            );
        } catch {
            // 私有浏览器存储不可用时，标题仍保留在当前画布会话中。
        }
    }, [canvasTitle, titleReady, userId, projectId]);
    useEffect(() => {
        try {
            const saved = readShopCanvasProjects(userId).find((item) => item.id === projectId)?.name || "未命名画布";
            titleStorageUser.current = userId;
            setCanvasTitle(saved);
            setTitleDraft(saved);
            setTitleReady(true);
        } catch {
            titleStorageUser.current = userId;
            setCanvasTitle("未命名画布");
            setTitleDraft("未命名画布");
            setTitleReady(true);
        }
    }, [userId, projectId]);
    const onRailClick = (key: RailKey) => {
        const next = activeRail === key ? null : key;
        if (key === "nodes") setNodeAnchor(undefined);
        setActiveRail(next);
    };

    const requestUpload = () => setUploadRequest((value) => (value || 0) + 1);

    const triggerNode = (action: (typeof NODE_ITEMS)[number]["action"], nodeId?: string) => {
        if (action === "group") {
            if (selectedLayerIds.length < 2) {
                message.info("先框选至少两个节点，再创建分组");
                return;
            }
            setLayerCommandRequest({ action: "group", ids: selectedLayerIds, nonce: Date.now() });
        } else if (action === "text") setToolRequest({ tool: "text", nonce: Date.now(), text: nodeId === "annotation" ? "商品备注" : "输入文案", annotation: nodeId === "annotation", position: nodeAnchor, connection: nodeAnchor?.connection });
        else if (action === "workflow") setActiveRail("workflows");
        else
            setDraftRequest({
                kind: nodeId || "chat",
                label: NODE_ITEMS.find((item) => item.id === nodeId)?.label || "对话生图",
                nonce: Date.now(),
                position: nodeAnchor,
                connection: nodeAnchor?.connection,
            });
        if (action !== "workflow") setActiveRail(null);
    };
    const openDraft = (id: string, kind: string, references: CommerceGraphNode[] = []) => {
        if (!draftsReady) {
            message.info("正在读取节点配置，请稍候");
            return;
        }
        if (kind === "inpaint") {
            message.info("画布局部重绘 · 敬请期待");
            return;
        }
        if (kind === "upload-card") return;
        if (kind === "product-video") {
            const node = snapshot.current.find((item) => item.id === id);
            if (node?.videoTaskId && !node.videoFailed) {
                message.info("视频正在生成，请等待结果");
                return;
            }
            const saved = nodeDrafts.current.get(id);
            setVideoGenerationNode({ id, inputs: shopCanvasVideoInputs(snapshot.current, id), draft: saved && "videoGeneration" in saved ? saved.videoGeneration : (node?.config as WorkbenchCanvasVideoDraft | undefined) });
            setComposerOpen(false);
            setActiveRail(null);
            return;
        }
        setVideoGenerationNode(null);
        const copiedConfig = snapshot.current.find((n) => n.id === id)?.config;
        if (copiedConfig && !nodeDrafts.current.has(id)) nodeDrafts.current.set(id, copiedConfig as ImageNodeDraft);
        if (activeDraftId && composerOpen && !pendingReferences) saveNodeDraft(activeDraftId);
        setActiveDraftId(id);
        const next = isTryOnFunction(kind) ? kind : "chat";
        if (isTryOnFunction(next) && !allowed.includes(next)) {
            message.warning("该电商功能暂未开放");
            return;
        }
        pick(next);
        setPendingReferences({ kind, references });
        setComposerOpen(true);
        setActiveRail(null);
    };
    useEffect(() => {
        if (!pendingReferences) return;
        const { kind, references } = pendingReferences;
        const next = isTryOnFunction(kind) ? kind : "chat";
        if (mode !== next || (next !== "chat" && imageState.draft.fn !== next)) return;
        const draft = activeDraftId ? nodeDrafts.current.get(activeDraftId) : undefined;
        const saved = draft && "image" in draft ? draft : undefined;
        const links = JSON.stringify(references.map((r) => [r.id, r.resourceId, r.type === "text" ? r.text : null]));
        activeLinks.current = links;
        imageState.update(saved?.image || { ...defaultTryOnDraft(), fn: imageState.draft.fn, imageModel: imageState.imageModel, ratio: imageState.ratio, resolution: imageState.resolution });
        if (saved && saved.links === links) {
            updateChatDraft(() => saved.chat);
            setPendingReferences(null);
            return;
        }
        const images = references.filter((r) => r.resourceId && r.type !== "video");
        const templatePrompt = snapshot.current.find((node) => node.id === activeDraftId)?.prompt;
        const linked = reconcileCommerceLinks(saved?.links, references, next === "chat" ? (saved?.chat.text ?? templatePrompt ?? SHOP_CANVAS_IMAGE_PROMPTS[kind] ?? "") : (saved?.image.notes ?? templatePrompt ?? ""));
        if (next === "chat") {
            updateChatDraft(() => ({ count: saved?.chat.count || 1, text: linked.text, refs: (saved?.chat.refs || []).filter((ref) => !linked.previousResourceIds.has(ref.resourceId)) }));
            addChatResources(images.map((r) => ({ resourceId: r.resourceId!, name: r.text || "画布参考图" })));
        } else {
            const slots = tryOnFunction(next).slots;
            const retained = (saved?.image.images[next] || []).filter((ref) => !linked.previousResourceIds.has(ref.resourceId));
            const imageMap: typeof imageState.draft.images = { ...saved?.image.images, [next]: retained };
            imageState.update({ images: imageMap, notes: linked.text });
            const incoming = images.filter((image) => !retained.some((ref) => ref.resourceId === image.resourceId));
            let index = 0;
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                const occupied = retained.filter((ref) => ref.slot === slot.key).length;
                const remainingMinimum = slots.slice(i + 1).reduce((sum, s) => sum + Math.max(0, s.min - retained.filter((ref) => ref.slot === s.key).length), 0);
                const take = Math.min(Math.max(0, slot.max - occupied), Math.max(slot.min - occupied, incoming.length - index - remainingMinimum));
                const picked = incoming.slice(index, index + take);
                if (picked.length)
                    imageState.addResources(
                        slot.key,
                        picked.map((r) => ({ resourceId: r.resourceId!, name: r.text || slot.label })),
                    );
                index += picked.length;
            }
        }
        setPendingReferences(null);
    }, [pendingReferences, mode, imageState.draft.fn]);
    useEffect(() => {
        if (activeDraftId && composerOpen && !pendingReferences) saveNodeDraft(activeDraftId);
    }, [activeDraftId, composerOpen, pendingReferences, imageState.draft, chatDraft]);
    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || (event.target instanceof Element && event.target.closest(".ant-modal, .ant-drawer, [role='dialog']"))) return;
            setActiveRail(null);
            setComposerOpen(false);
            setVideoGenerationNode(null);
            setHelpTab(null);
            setLinkDialogOpen(false);
        };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, []);

    const finishTitleEdit = () => {
        const next = titleDraft.trim() || "未命名画布";
        setCanvasTitle(next);
        setTitleDraft(next);
        setTitleEditing(false);
    };

    const selectedItems = canvasItems.filter((item) => selectedLayerIds.includes(item.id));
    const downloadableCount = selectedItems.filter((item) => (item.type === "image" || item.type === "video") && item.resourceId).length;
    const openContextMenu = (event: ReactMouseEvent, target?: EcommerceCanvasContextTarget) => {
        event.preventDefault();
        if (target?.type === "result") {
            setContextMenu({ scope: "node", x: event.clientX, y: event.clientY, selectedCount: 1, downloadableCount: 1, canGenerate: true, canUndo: historyState.canUndo, canRedo: historyState.canRedo });
            return;
        }
        const ids = !target ? [] : !selectedLayerIds.includes(target.id) ? [target.id] : selectedLayerIds;
        if (!target) {
            setSelectedLayerIds([]);
            setSelectLayersRequest({ ids: [], nonce: Date.now() });
        }
        if (target && !selectedLayerIds.includes(target.id)) {
            setSelectedLayerIds(ids);
            setSelectLayersRequest({ ids, nonce: Date.now() });
        }
        const items = canvasItems.filter((item) => ids.includes(item.id));
        setContextMenu({
            scope: ids.length > 1 ? "selection" : target ? "node" : "canvas",
            x: event.clientX,
            y: event.clientY,
            selectedCount: ids.length,
            downloadableCount: items.filter((item) => (item.type === "image" || item.type === "video") && item.resourceId).length,
            canGenerate: items.some((item) => item.type === "draft" || (item.type === "image" && item.resourceId)),
            canPaste: clipboardIds.current.length > 0,
            canUndo: historyState.canUndo,
            canRedo: historyState.canRedo,
        });
    };
    useEffect(() => {
        const failed = (event: Event) => {
            const detail = (event as CustomEvent<{ owner: string; message: string }>).detail;
            if (detail?.owner === scope && getActiveUserScope() === scope) message.error(detail.message);
        };
        window.addEventListener("commerce-download-error", failed);
        return () => window.removeEventListener("commerce-download-error", failed);
    }, [message, scope]);
    const downloadSelected = () => {
        const images = [...new Set(selectedItems.filter((item) => item.type === "image" && item.resourceId).map((item) => item.resourceId!))];
        const videos = [...new Set(selectedItems.filter((item) => item.type === "video" && item.resourceId).map((item) => item.resourceId!))];
        if (images.length > 500) {
            message.warning("每次最多下载 500 张图片，请分批选择");
            return;
        }
        if (images.length) startEcommerceDownload(images.map((resourceId, index) => ({ image: { imageType: "single" } as EcommercePlanImage, assetId: "", index, resourceId })));
        void Promise.all(videos.map((id, index) => downloadBrowserMedia({ storageKey: resourceStorageKey(id), fileName: `电商视频-${index + 1}.mp4` }))).catch((error) => message.error(error instanceof Error ? error.message : "视频下载失败，请重试"));
    };
    const copySelected = () => {
        clipboardIds.current = [...selectedLayerIds];
        message.success(`已复制 ${selectedLayerIds.length} 个电商节点`);
    };
    const deleteSelected = () => {
        setLayerCommandRequest({ action: "delete", ids: selectedLayerIds, nonce: Date.now() });
        setSelectedLayerIds([]);
        message.info("已删除选中节点");
    };
    const duplicateSelected = () => {
        setLayerCommandRequest({ action: "duplicate", ids: selectedLayerIds, nonce: Date.now() });
        message.success("已复制节点");
    };
    const arrangeSelected = (action: ShopCanvasArrangeAction) => {
        setLayerCommandRequest({ action: "arrange", ids: selectedLayerIds, arrangeAction: action, nonce: Date.now() });
    };
    const bringSelectedToFront = () => {
        setLayerCommandRequest({ action: "bring-front", ids: selectedLayerIds, nonce: Date.now() });
    };
    const sendSelectedToBack = () => {
        setLayerCommandRequest({ action: "send-back", ids: selectedLayerIds, nonce: Date.now() });
    };
    const generateSelected = () => {
        const draftNode = selectedItems.find((item) => item.type === "draft");
        if (draftNode) {
            openDraft(draftNode.id, draftNode.draftKind || "chat", commerceNodeReferences(snapshot.current, draftNode.id));
            return;
        }
        const refs = selectedItems.filter((item) => item.type === "image" && item.resourceId).map((item) => `primary:${item.resourceId}`);
        if (!refs.length) {
            message.info("请先框选至少一张商品图片");
            return;
        }
        setActiveDraftId(undefined);
        setVideoGenerationNode(null);
        pick("chat");
        updateChatDraft((draft) => ({ ...draft, text: "使用画布框选素材生成电商商品视觉", refs: [] }));
        addChatResources(refs.map((value) => ({ resourceId: value.slice("primary:".length), name: "画布素材" })));
        if (refs.length > 6) message.info("对话生图最多使用 6 张参考图，已带入前 6 张");
        setComposerOpen(true);
    };
    const pasteSelected = () => {
        if (clipboardIds.current.length) setLayerCommandRequest({ action: "duplicate", ids: clipboardIds.current, nonce: Date.now() });
    };
    const openCreator = () => generateSelected();
    const flipSelected = (axis: "flip-horizontal" | "flip-vertical") => setLayerCommandRequest({ action: axis, ids: selectedLayerIds, nonce: Date.now() });
    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(selectedItems.map((item) => item.label).join("\n"));
            message.success("节点名称已复制到剪贴板");
        } catch {
            message.info("当前浏览器不允许访问剪贴板");
        }
    };

    const importCanvasLink = async () => {
        const url = linkDialogUrl.trim();
        if (!url) {
            setLinkDialogError(`请粘贴${linkKind === "video" ? "视频" : "图片"}链接`);
            return;
        }
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            setLinkDialogError("请输入完整的 http 或 https 链接");
            return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            setLinkDialogError("只支持 http 或 https 链接");
            return;
        }
        setLinkDialogBusy(true);
        setLinkDialogError("");
        try {
            const resource = await importResourceFromUrl(parsed.toString(), linkKind);
            if (linkKind === "image") {
                setResourceRequest({ resourceId: resource.id, kind: "image", nonce: Date.now() });
                message.success("图片已解析并放入画布");
            } else {
                setResourceRequest({ resourceId: resource.id, kind: "video", nonce: Date.now() });
                message.success("视频已解析并放入画布");
            }
            setLinkDialogUrl("");
            setLinkDialogOpen(false);
        } catch (error) {
            setLinkDialogError(error instanceof Error ? error.message || "解析失败，请检查链接后重试" : "解析失败，请检查链接后重试");
        } finally {
            setLinkDialogBusy(false);
        }
    };

    const linkDialog = (
        <AppModal
            open={linkDialogOpen}
            centered
            width={500}
            classNames={{ container: "ms-scope sp-canvas-link-dialog" }}
            title="解析链接上传"
            cancelText="取消"
            okText={linkDialogBusy ? "解析中…" : "解析并上传"}
            confirmLoading={linkDialogBusy}
            okButtonProps={{ disabled: !linkDialogUrl.trim() }}
            onCancel={() => setLinkDialogOpen(false)}
            onOk={() => void importCanvasLink()}
        >
            <div className="sp-canvas-link-content" data-canvas-no-zoom>
                <SegmentedControl
                    value={linkKind}
                    options={LINK_KINDS}
                    ariaLabel="素材类型"
                    className="sp-canvas-link-tabs"
                    block
                    onChange={(kind) => {
                        setLinkKind(kind);
                        setLinkDialogError("");
                    }}
                />
                <p>{linkKind === "video" ? "支持抖音、快手、小红书和视频号分享链接。" : "粘贴商品图片链接，解析后将图片添加到画布。"}</p>
                <label className="sp-canvas-link-dialog-input">
                    <span>{linkKind === "video" ? "视频分享链接" : "商品图片链接"}</span>
                    <Input
                        variant="filled"
                        size="large"
                        value={linkDialogUrl}
                        onChange={(event) => {
                            setLinkDialogUrl(event.target.value);
                            if (linkDialogError) setLinkDialogError("");
                        }}
                        placeholder={linkKind === "video" ? "粘贴视频链接或分享文案" : "https://example.com/product.jpg"}
                        status={linkDialogError ? "error" : undefined}
                        onPressEnter={() => {
                            if (linkDialogUrl.trim() && !linkDialogBusy) void importCanvasLink();
                        }}
                        autoFocus
                    />
                </label>
                {linkDialogError ? (
                    <p className="sp-canvas-link-dialog-error" role="alert">
                        {linkDialogError}
                    </p>
                ) : null}
            </div>
        </AppModal>
    );

    return (
        <main className="sp-canvas-page ms-scope" aria-label="电商画布">
            <header className="sp-canvas-topbar">
                <div className="sp-canvas-title-group" data-canvas-no-zoom>
                    <span className="sp-canvas-brand" aria-label="MeiyeAI">
                        <BrandLogoFrame logoClassName="size-7 object-contain" alt="MeiyeAI" fallback={<ShoppingBag size={24} />} />
                    </span>
                    <button type="button" className="sp-canvas-back" onClick={() => navigate("/shop/canvas")} aria-label="返回电商画布项目" title="返回电商画布项目">
                        <ArrowLeft size={17} />
                    </button>
                    <div className="sp-canvas-title-edit-wrap">
                        {titleEditing ? (
                            <input
                                className="sp-canvas-title-input"
                                value={titleDraft}
                                autoFocus
                                aria-label="画布名称"
                                onChange={(event) => setTitleDraft(event.target.value)}
                                onBlur={finishTitleEdit}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") finishTitleEdit();
                                    if (event.key === "Escape") {
                                        setTitleDraft(canvasTitle);
                                        setTitleEditing(false);
                                    }
                                }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="sp-canvas-title-button"
                                onClick={() => {
                                    setTitleDraft(canvasTitle);
                                    setTitleEditing(true);
                                }}
                                aria-label="修改画布名称"
                            >
                                <strong>{canvasTitle}</strong>
                                <Pencil size={14} aria-hidden="true" />
                            </button>
                        )}
                        <span>电商画布 · 本机工作区</span>
                    </div>
                </div>
                <WorkspaceTopBar floating sidebarOpen={false} onToggleSidebar={() => {}} />
            </header>
            <div className="sp-canvas-shell">
                <nav className="sp-canvas-rail" aria-label="画布工具" data-canvas-no-zoom data-canvas-wheel-scroll>
                    <div className="sp-canvas-rail-items">
                        {RAIL_ITEMS.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                type="button"
                                className="sp-canvas-rail-item"
                                data-primary={key === "nodes" || undefined}
                                data-active={activeRail === key || undefined}
                                onClick={() => onRailClick(key)}
                                aria-label={label}
                                aria-pressed={activeRail === key}
                                title={key === "nodes" ? label : undefined}
                            >
                                <Icon aria-hidden="true" />
                                {key !== "nodes" ? <span>{label}</span> : null}
                            </button>
                        ))}
                    </div>
                    <div className="sp-canvas-rail-divider" />
                    <button type="button" className="sp-canvas-rail-item" onClick={() => setHelpTab("tutorial")} aria-label="帮助中心">
                        <CircleHelp aria-hidden="true" />
                        <span>帮助</span>
                    </button>
                    <button type="button" className="sp-canvas-rail-item" onClick={() => setSupportOpen(true)} aria-label="联系客服">
                        <Headset aria-hidden="true" />
                        <span>客服</span>
                    </button>
                </nav>
                <div className="sp-canvas-workspace">
                    <ShopCanvasPanels
                        panel={activeRail}
                        anchor={nodeAnchor}
                        connectionNode={snapshot.current.find((node) => node.id === nodeAnchor?.connection?.nodeId)}
                        projectName={canvasTitle}
                        onClose={() => setActiveRail(null)}
                        onAdd={(item) => triggerNode(item.action, item.id)}
                        onUpload={requestUpload}
                        onLibrary={() => setLibraryOpen(true)}
                        items={canvasItems}
                        historyItems={generationItems.map((item) => ({ id: item.key, label: item.label, type: "image", resourceId: item.resourceId }))}
                        onUseHistory={(item) => {
                            if (item.resourceId) setResourceRequest({ resourceId: item.resourceId, nonce: Date.now() });
                            else message.info("生成结果尚未就绪，请稍后查看");
                        }}
                        onFocus={(id) => {
                            setFocusLayerRequest({ id, nonce: Date.now() });
                            setActiveRail(null);
                        }}
                        scope={scope}
                        onSave={() =>
                            snapshot.current.map((n) => {
                                const draft = nodeDrafts.current.get(n.id);
                                const config = draft && "videoGeneration" in draft ? draft.videoGeneration : draft;
                                return { ...n, config: config || n.config };
                            })
                        }
                        onInsert={(nodes) => {
                            setWorkflowRequest({ nodes, nonce: Date.now() });
                            setActiveRail(null);
                        }}
                    />
                    <EcommerceResultCanvas
                        key={`shop-canvas:${userId}:${projectId}`}
                        children={null}
                        count={0}
                        ratio="1:1"
                        storageKey={`shop-canvas:${userId}:${projectId}`}
                        persistenceScope={scope}
                        updateNodeRequest={updateNodeRequest}
                        videoTaskReceipts={videoTaskReceipts}
                        toolRequest={toolRequest}
                        uploadRequest={uploadRequest}
                        focusLayerRequest={focusLayerRequest}
                        resourceRequest={resourceRequest}
                        onCanvasContextMenu={openContextMenu}
                        onSelectLayers={handleLayerSelection}
                        selectLayersRequest={selectLayersRequest}
                        layerCommandRequest={layerCommandRequest}
                        onCanvasItemsChange={handleCanvasItemsChange}
                        historyRequest={historyRequest}
                        onHistoryStateChange={setHistoryState}
                        generationRequest={generationRequest}
                        generations={generations}
                        draftRequest={draftRequest}
                        onOpenDraft={openDraft}
                        onConnectionDrop={(anchor) => {
                            setNodeAnchor(anchor);
                            setActiveRail("nodes");
                        }}
                        actions={null}
                        graphEnabled
                        workflowRequest={workflowRequest}
                        onSnapshotChange={onSnapshotChange}
                    />
                    {selectedLayerIds.length > 1 ? (
                        <div className="sp-canvas-selection-actions" data-canvas-no-zoom>
                            <span>已选 {selectedLayerIds.length} 个节点</span>
                            <button type="button" disabled={!downloadableCount} onClick={downloadSelected}>
                                下载素材
                            </button>
                            <button type="button" disabled={!selectedItems.some((item) => item.type === "draft" || (item.type === "image" && item.resourceId))} onClick={generateSelected}>
                                生成图片
                            </button>
                            <button type="button" onClick={() => setLayerCommandRequest({ action: "group", ids: selectedLayerIds, nonce: Date.now() })}>
                                分组
                            </button>
                            <button type="button" onClick={() => setLayerCommandRequest({ action: "ungroup", ids: selectedLayerIds, nonce: Date.now() })}>
                                取消分组
                            </button>
                            <button type="button" onClick={() => arrangeSelected("grid")}>
                                网格排列
                            </button>
                            <button type="button" onClick={() => arrangeSelected("row")}>
                                横向排列
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
            <ShopCanvasContextMenu
                menu={contextMenu}
                onClose={() => setContextMenu(null)}
                onUpload={requestUpload}
                onParseLinkUpload={() => {
                    setLinkKind("image");
                    setLinkDialogUrl("");
                    setLinkDialogError("");
                    setLinkDialogOpen(true);
                }}
                onAddNode={() => {
                    setNodeAnchor(contextMenu ? { x: contextMenu.x, y: contextMenu.y } : undefined);
                    setActiveRail("nodes");
                }}
                onAddNote={() => setToolRequest({ tool: "text", nonce: Date.now(), text: "商品备注", annotation: true, position: contextMenu || undefined })}
                onAddCopy={() => setToolRequest({ tool: "text", nonce: Date.now(), text: "商品卖点文案", fontSize: 32, position: contextMenu || undefined })}
                onUndo={() => setHistoryRequest({ action: "undo", nonce: Date.now() })}
                onRedo={() => setHistoryRequest({ action: "redo", nonce: Date.now() })}
                onPaste={pasteSelected}
                onDownload={downloadSelected}
                onGenerate={generateSelected}
                onArrange={arrangeSelected}
                onBringToFront={bringSelectedToFront}
                onSendToBack={sendSelectedToBack}
                onCopy={duplicateSelected}
                onGroupCopy={duplicateSelected}
                onOpenCreator={openCreator}
                onFlipHorizontal={() => flipSelected("flip-horizontal")}
                onFlipVertical={() => flipSelected("flip-vertical")}
                onCopyToClipboard={() => void copyToClipboard()}
                onDelete={deleteSelected}
            />
            <ShopCanvasComposer
                open={composerOpen}
                nodeId={activeDraftId}
                title={canvasItems.find((i) => i.id === activeDraftId)?.label || "对话生图"}
                onClose={() => {
                    if (activeDraftId) saveNodeDraft(activeDraftId);
                    setComposerOpen(false);
                    setActiveDraftId(undefined);
                }}
            >
                {edits.loaded ? (
                    <ShopComposer
                        modelBoundCount
                        variant="dock"
                        state={imageState}
                        allowed={allowed}
                        mode={mode}
                        onPickFunction={pick}
                        onSubmitted={(keys) => {
                            setGenerationRequest({ keys, nonce: Date.now(), targetId: activeDraftId });
                            setComposerOpen(false);
                            setActiveDraftId(undefined);
                        }}
                    />
                ) : (
                    <p role="status">正在读取电商创作记录…</p>
                )}
            </ShopCanvasComposer>
            {videoGenerationNode ? (
                <Suspense fallback={null}>
                    <ShopCanvasVideoGeneration
                        key={videoGenerationNode.id}
                        nodeId={videoGenerationNode.id}
                        onClose={() => setVideoGenerationNode(null)}
                        draft={videoGenerationNode.draft}
                        inputs={videoGenerationNode.inputs}
                        submitting={submittingVideoNodes.has(videoGenerationNode.id)}
                        onDraftChange={saveVideoGenerationDraft}
                        submitTask={submitCanvasVideo}
                    />
                </Suspense>
            ) : null}
            <WorkbenchAssetPicker
                open={libraryOpen}
                accept={["image", "video"]}
                maxCount={1}
                onClose={() => setLibraryOpen(false)}
                onPick={(assets) => {
                    const asset = assets[0];
                    if (asset) setResourceRequest({ resourceId: asset.resourceId, kind: asset.kind === "video" ? "video" : "image", nonce: Date.now() });
                }}
            />
            <AppModal open={Boolean(helpTab)} onCancel={() => setHelpTab(null)} title="帮助中心" footer={null} width={800}>
                <div className="sp-canvas-help">
                    <div className="sp-canvas-segments">
                        <button aria-pressed={helpTab === "tutorial"} onClick={() => setHelpTab("tutorial")}>
                            使用教程
                        </button>
                        <button aria-pressed={helpTab === "shortcuts"} onClick={() => setHelpTab("shortcuts")}>
                            快捷键
                        </button>
                    </div>
                    {helpTab === "tutorial" ? (
                        <ol>
                            <li>点击左侧 + 创建节点，或从素材库导入商品图片和视频。</li>
                            <li>从节点右侧 + 拖到其他节点左侧 +，将素材或文案传给下游。</li>
                            <li>点击节点的配置入口，选择模型、比例、分辨率与张数，再确认生成。</li>
                            <li>右键操作节点；框选多个节点后可整理、分组与批量下载。</li>
                            <li>按 Esc 收起面板；画布内容保存在当前浏览器。</li>
                        </ol>
                    ) : (
                        <div className="sp-canvas-shortcuts">
                            {[
                                ["移动画布", "Space + 拖动"],
                                ["缩放画布", "Ctrl + 滚轮"],
                                ["选择 / 抓手", "V / H"],
                                ["文字节点", "T"],
                                ["撤销 / 重做", "Ctrl Z / Ctrl Shift Z"],
                                ["删除节点", "Delete"],
                                ["关闭面板", "Esc"],
                            ].map(([name, key]) => (
                                <div key={name}>
                                    <span>{name}</span>
                                    <kbd>{key}</kbd>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </AppModal>
            <FeedbackModal open={supportOpen} onClose={() => setSupportOpen(false)} />
            {linkDialog}
        </main>
    );
}
