import type { WorkbenchCanvasVideoInputs } from "@/pages/workbench/image-workbench-page";

export type CommerceGraphNode = { id: string; inputs?: string[]; type: string; resourceId?: string; text?: string; draftKind?: string; materialCategory?: string };

export function connectCommerceNodes<T extends CommerceGraphNode>(nodes: T[], source: string, target: string): { nodes: T[]; error?: string } {
    const from = nodes.find((n) => n.id === source),
        to = nodes.find((n) => n.id === target);
    if (!from || !to) return { nodes, error: "连接的节点已不存在" };
    if (source === target) return { nodes, error: "节点不能连接自己" };
    if (to.inputs?.includes(source)) return { nodes, error: "这两个节点已经连接" };
    const visited = new Set<string>();
    const dependsOn = (id: string): boolean => {
        if (id === target) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        return (nodes.find((n) => n.id === id)?.inputs || []).some(dependsOn);
    };
    if (dependsOn(source)) return { nodes, error: "连接会形成循环，请调整方向" };
    return { nodes: nodes.map((n) => (n.id === target ? { ...n, inputs: [...(n.inputs || []), source] } : n)) };
}

/** 只把上游实际存在的素材和文字交给生成；未完成节点不伪装成参考图。 */
export function commerceNodeReferences(nodes: CommerceGraphNode[], target: string) {
    const visited = new Set<string>();
    const references: CommerceGraphNode[] = [];
    const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = nodes.find((n) => n.id === id);
        if (!node) return;
        if (node.resourceId || node.type === "text") references.push(node);
        else node.inputs?.forEach(visit);
    };
    nodes.find((n) => n.id === target)?.inputs?.forEach(visit);
    return references;
}

export function shopCanvasVideoInputs(nodes: CommerceGraphNode[], target: string): WorkbenchCanvasVideoInputs {
    const references: WorkbenchCanvasVideoInputs["references"] = [];
    const seen = new Set<string>();
    const texts: string[] = [];
    let pending = false;
    for (const id of nodes.find((node) => node.id === target)?.inputs || []) {
        const node = nodes.find((item) => item.id === id);
        if (node?.type === "text") {
            if (node.text?.trim()) texts.push(node.text.trim());
        } else if (node?.resourceId && ["image", "video", "generation"].includes(node.type)) {
            if (seen.has(node.resourceId)) continue;
            seen.add(node.resourceId);
            const kind = node.type === "video" ? "video" : "image";
            references.push({ id, resourceId: node.resourceId, kind, name: node.text || (kind === "video" ? "参考视频" : "参考图") });
        } else {
            pending = true;
        }
    }
    return { references, text: texts.join("\n"), pending };
}

export function commerceConnectionPath(from: { x: number; y: number }, to: { x: number; y: number }) {
    const bend = Math.max(56, Math.abs(to.x - from.x) * 0.48);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

/** Replace unchanged linked content while retaining manual edits and uploads. */
export function reconcileCommerceLinks(previous: string | undefined, references: CommerceGraphNode[], text: string) {
    let prior: Array<[string, string | null, string | null]> = [];
    try {
        const parsed: unknown = JSON.parse(previous || "[]");
        if (Array.isArray(parsed)) prior = parsed.filter((row) => Array.isArray(row) && typeof row[0] === "string");
    } catch {
        // An older malformed snapshot must not erase the user's current draft.
    }
    const oldText = prior
        .map((row) => row[2])
        .filter(Boolean)
        .join("\n");
    const newText = references
        .filter((node) => node.type === "text")
        .map((node) => node.text)
        .filter(Boolean)
        .join("\n");
    let manual = text;
    if (oldText && oldText !== newText) {
        if (manual === oldText) manual = "";
        else if (manual.endsWith(`\n${oldText}`)) manual = manual.slice(0, -oldText.length - 1);
    }
    const alreadyIncluded = newText && (manual === newText || manual.endsWith(`\n${newText}`));
    return {
        text: newText && !alreadyIncluded ? [manual, newText].filter(Boolean).join("\n") : manual,
        previousResourceIds: new Set(prior.map((row) => row[1]).filter((id): id is string => typeof id === "string" && Boolean(id))),
    };
}
