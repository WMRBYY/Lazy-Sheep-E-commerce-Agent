import { expect, test } from "bun:test";
import { COMMERCE_WORKFLOW_LIBRARY } from "../src/pages/shop/shop-canvas-workflow-library";
import { cloneWorkflowNodes } from "../src/pages/shop/shop-canvas-workflows";
import { SHOP_CANVAS_TOOLS } from "../src/pages/shop/shop-canvas-catalog";

test("recommended workflows have executable nodes, intact acyclic links and explicit unavailable capabilities", () => {
    expect(COMMERCE_WORKFLOW_LIBRARY.length).toBeGreaterThan(0);
    expect(new Set(COMMERCE_WORKFLOW_LIBRARY.map((w) => w.id)).size).toBe(COMMERCE_WORKFLOW_LIBRARY.length);
    for (const workflow of COMMERCE_WORKFLOW_LIBRARY) {
        const ids = new Set(workflow.nodes.map((n) => n.id));
        expect(ids.size).toBe(workflow.nodes.length);
        expect(workflow.nodes.some((n) => n.draftKind === "upload-card")).toBe(true);
        for (const node of workflow.nodes) {
            for (const input of node.inputs || []) expect(ids.has(input)).toBe(true);
            if (node.type === "draft") {
                const tool = SHOP_CANVAS_TOOLS.find((t) => t.id === node.draftKind);
                expect(tool).toBeDefined();
                if (tool?.comingSoon) expect(workflow.limitation).toContain("敬请期待");
                if (node.draftKind !== "upload-card") expect(node.prompt?.length).toBeGreaterThan(10);
            }
            const visit = (id: string, seen: Set<string>) => {
                expect(seen.has(id)).toBe(false);
                for (const input of workflow.nodes.find((n) => n.id === id)?.inputs || []) visit(input, new Set([...seen, id]));
            };
            visit(node.id, new Set());
        }
    }
});

test("copy is independent and does not reconnect an active generation job", () => {
    const original = structuredClone(COMMERCE_WORKFLOW_LIBRARY[0].nodes);
    original[1].config = { image: { notes: "用户修改" } };
    original[1].videoTaskId = "charged-task";
    const copied = cloneWorkflowNodes(original);
    const oldIds = new Set(original.map((n) => n.id));
    const newIds = new Set(copied.map((n) => n.id));
    for (const node of copied) {
        expect(oldIds.has(node.id)).toBe(false);
        expect(node.videoTaskId).toBeUndefined();
        for (const input of node.inputs || []) expect(newIds.has(input)).toBe(true);
    }
    expect(copied[1].config).toEqual(original[1].config);
    expect(copied[1].config).not.toBe(original[1].config);
    const grouped = original.findIndex((node) => node.groupId);
    expect(copied[grouped].prompt).toBe(original[grouped].prompt);
    expect(copied[grouped].groupId).not.toBe(original[grouped].groupId);
});
