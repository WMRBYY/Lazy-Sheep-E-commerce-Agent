import { useEffect, useRef, useState } from "react";
import { App, Dropdown, Tooltip } from "antd";
import { Copy, ImagePlus, MoreHorizontal, Pencil, Trash2, Workflow } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { readShopCanvasProjects, saveShopCanvasProjects, type ShopCanvasProject } from "./shop-canvas-projects";
import { duplicateCanvasProject, saveCanvasCover } from "./shop-canvas-project-actions";

export function ShopCanvasProjectCard({ project, scope, userId, onOpen, onChange }: { project: ShopCanvasProject; scope: string; userId: string; onOpen: () => void; onChange: () => void }) {
    const { message } = App.useApp();
    const [cover, setCover] = useState("");
    const [editing, setEditing] = useState<"rename" | "delete" | null>(null);
    const [name, setName] = useState(project.name);
    const [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        let alive = true;
        setCover("");
        if (project.coverKey)
            void Promise.resolve(localForageStorageForScope(scope).getItem(project.coverKey))
                .then((value) => {
                    if (alive) setCover(value || "");
                })
                .catch(() => {
                    if (alive) message.error("封面读取失败，请重试");
                });
        return () => {
            alive = false;
        };
    }, [scope, project.coverKey]);
    const run = async (action: () => Promise<void> | void) => {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            onChange();
            setEditing(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败，请检查浏览器存储空间后重试");
        } finally {
            setBusy(false);
        }
    };
    const update = (patch: Partial<ShopCanvasProject>) =>
        saveShopCanvasProjects(
            userId,
            readShopCanvasProjects(userId).map((item) => (item.id === project.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)),
        );
    const remove = async () => {
        // Retain an undo snapshot and the original nodes/resources; deleting a card never deletes media assets.
        await localForageStorageForScope(scope).setItem(`shop-canvas-removed:${project.id}`, JSON.stringify(project));
        saveShopCanvasProjects(
            userId,
            readShopCanvasProjects(userId).filter((item) => item.id !== project.id),
        );
        message.success({
            duration: 8,
            content: (
                <span>
                    项目已删除{" "}
                    <button
                        onClick={() => {
                            void run(() => {
                                const current = readShopCanvasProjects(userId);
                                if (!current.some((item) => item.id === project.id)) saveShopCanvasProjects(userId, [project, ...current]);
                            });
                        }}
                    >
                        撤销
                    </button>
                </span>
            ),
        });
    };
    return (
        <article className="sp-canvas-project-wrap" aria-label={`${project.name} 项目`}>
            <button type="button" className="sp-canvas-project" onClick={onOpen}>
                <span className="sp-canvas-project-preview">{cover ? <img src={cover} alt={`${project.name} 封面`} /> : <Workflow size={30} />}</span>
                <strong>{project.name}</strong>
                <small>更新于 {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
            </button>
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                    items: [
                        { key: "rename", label: "重命名", icon: <Pencil size={15} /> },
                        { key: "copy", label: "复制", icon: <Copy size={15} /> },
                        { key: "cover", label: "更换封面", icon: <ImagePlus size={15} /> },
                        { type: "divider" },
                        { key: "delete", label: "删除", danger: true, icon: <Trash2 size={15} /> },
                    ],
                    onClick: ({ key }) => {
                        if (key === "copy")
                            void run(async () => {
                                await duplicateCanvasProject(scope, userId, project);
                                message.success("已复制项目，可独立编辑");
                            });
                        else if (key === "cover") input.current?.click();
                        else {
                            setName(project.name);
                            setEditing(key as "rename" | "delete");
                        }
                    },
                }}
            >
                <Tooltip title="项目操作">
                    <button className="sp-project-more" aria-label={`${project.name} 操作菜单`} disabled={busy}>
                        <MoreHorizontal size={19} />
                    </button>
                </Tooltip>
            </Dropdown>
            <input
                ref={input}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                aria-label={`${project.name} 封面文件`}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file)
                        void run(async () => {
                            const coverKey = await saveCanvasCover(scope, file);
                            update({ coverKey });
                            message.success("封面已更新");
                        });
                }}
            />
            <AppModal open={Boolean(editing)} onCancel={() => !busy && setEditing(null)} title={editing === "delete" ? "删除项目" : "重命名项目"} footer={null} destroyOnHidden>
                <form
                    className="sp-canvas-create-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void run(
                            editing === "delete"
                                ? remove
                                : () => {
                                      if (!name.trim()) throw new Error("请输入项目名称");
                                      update({ name: name.trim() });
                                  },
                        );
                    }}
                >
                    {editing === "delete" ? (
                        <p>删除「{project.name}」？项目将从本机列表移除，素材库中的图片和视频会保留。</p>
                    ) : (
                        <>
                            <label htmlFor={`name-${project.id}`}>项目名称</label>
                            <input id={`name-${project.id}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />
                        </>
                    )}
                    <div>
                        <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                            取消
                        </button>
                        <button type="submit" disabled={busy}>
                            {busy ? "处理中…" : editing === "delete" ? "删除项目" : "保存"}
                        </button>
                    </div>
                </form>
            </AppModal>
        </article>
    );
}
