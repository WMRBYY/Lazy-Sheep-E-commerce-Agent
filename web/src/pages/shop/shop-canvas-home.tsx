import { useEffect, useMemo, useState } from "react";
import { App, Button, Input } from "antd";
import { Grid2X2, List, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceStorageKey, resolveResourceVariantUrl } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import { readShopCanvasProjects, saveShopCanvasProjects } from "./shop-canvas-projects";
import { useShopScope } from "./shop-context";
import { copyWorkflowProject, readShopWorkflows, type ShopWorkflow } from "./shop-canvas-workflows";
import { ShopWorkflowPreview } from "./shop-workflow-preview";
import { ShopWorkflowCard } from "./shop-workflow-card";
import { ShopWorkflowSubmit } from "./shop-workflow-submit";
import { ShopCanvasProjectCard } from "./shop-canvas-project-card";
import "./shop-canvas-home.css";

export default function ShopCanvasHome() {
    const userId = useUserStore((state) => state.user?.id || "guest");
    return <ShopCanvasHomeContent key={userId} userId={userId} />;
}

function ShopCanvasHomeContent({ userId }: { userId: string }) {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [projects, setProjects] = useState(() => readShopCanvasProjects(userId));
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState("");
    const [view, setView] = useState<"grid" | "list">("grid");
    const scope = useShopScope();
    const [templates, setTemplates] = useState<ShopWorkflow[]>([]);
    const [preview, setPreview] = useState<ShopWorkflow | null>(null);
    const [copying, setCopying] = useState(false);
    useEffect(() => {
        let alive = true;
        setProjects(readShopCanvasProjects(userId));
        void readShopWorkflows(scope)
            .then((value) => {
                if (alive) setTemplates(value);
            })
            .catch(() => message.error("工作流读取失败，请重试"));
        return () => {
            alive = false;
        };
    }, [scope, userId]);
    const copy = async () => {
        if (!preview || copying) return;
        setCopying(true);
        try {
            const project = await copyWorkflowProject(scope, userId, preview);
            navigate(`/shop/canvas/${project.id}`);
        } catch {
            message.error("复制失败，请检查浏览器存储空间后重试");
        } finally {
            setCopying(false);
        }
    };
    const visible = useMemo(() => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projects]);
    const create = () => {
        const project = { id: crypto.randomUUID(), name: draft.trim() || "未命名画布", updatedAt: new Date().toISOString() };
        try {
            saveShopCanvasProjects(userId, [project, ...projects]);
            navigate(`/shop/canvas/${project.id}`);
        } catch {
            message.error("画布创建失败，请检查浏览器存储空间后重试");
        }
    };
    return (
        <main className="sp-canvas-home ms-scope" aria-label="电商画布项目">
            <section className="sp-canvas-home-content">
                <header className="sp-canvas-home-heading">
                    <div>
                        <h1>项目</h1>
                        <span>{projects.length} 个 · 当前账号的本机项目</span>
                    </div>
                    <div role="group" aria-label="排列方式">
                        <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="网格排列">
                            <Grid2X2 size={18} />
                        </button>
                        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} title="列表排列">
                            <List size={18} />
                        </button>
                    </div>
                </header>
                <div className={`sp-canvas-projects is-${view}`}>
                    <button
                        type="button"
                        className="sp-canvas-project sp-canvas-create"
                        onClick={() => {
                            setDraft("");
                            setCreating(true);
                        }}
                    >
                        <span className="sp-canvas-project-preview">
                            <Plus size={30} />
                        </span>
                        <strong>新建项目</strong>
                    </button>
                    {visible.map((project) => (
                        <ShopCanvasProjectCard key={`${userId}:${project.id}`} project={project} scope={scope} userId={userId} onOpen={() => navigate(`/shop/canvas/${project.id}`)} onChange={() => setProjects(readShopCanvasProjects(userId))} />
                    ))}
                </div>
                <section className="sp-canvas-workflows" aria-labelledby="shop-my-workflows">
                    <h2 id="shop-my-workflows">我的工作流</h2>
                    {templates.length ? (
                        <div className="sp-workflow-cards">
                            {templates.map((workflow) => {
                                const resourceId = workflow.nodes.find((node) => node.resourceId && node.type !== "video")?.resourceId;
                                return (
                                    <ShopWorkflowCard
                                        key={workflow.id}
                                        name={workflow.name}
                                        description={`${workflow.nodes.length} 个节点`}
                                        image={resourceId ? resolveResourceVariantUrl(resourceStorageKey(resourceId), "thumbnail") : undefined}
                                        onOpen={() => setPreview(workflow)}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <p>在项目里打开「工作流」，保存后可在这里查看或提交审核。</p>
                    )}
                </section>
            </section>
            <AppModal open={creating} onCancel={() => setCreating(false)} title="新建画布" footer={null} destroyOnHidden className="sp-canvas-project-modal ms-scope">
                <form
                    className="sp-canvas-create-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        create();
                    }}
                >
                    <label htmlFor="shop-canvas-project-name">画布名称（可留空，默认「未命名画布」）</label>
                    <Input id="shop-canvas-project-name" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="未命名画布" autoFocus maxLength={80} />
                    <div>
                        <Button onClick={() => setCreating(false)}>取消</Button>
                        <Button type="primary" htmlType="submit">
                            创建
                        </Button>
                    </div>
                </form>
            </AppModal>
            <ShopWorkflowPreview
                workflow={preview}
                onClose={() => setPreview(null)}
                onCopy={() => void copy()}
                busy={copying}
                actions={preview && userId !== "guest" ? <ShopWorkflowSubmit key={`${userId}:${preview.id}`} workflow={preview} userId={userId} /> : null}
            />
        </main>
    );
}
