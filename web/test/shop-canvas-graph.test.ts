import { expect, test } from "bun:test";
import { commerceNodeReferences, connectCommerceNodes, reconcileCommerceLinks, shopCanvasVideoInputs, type CommerceGraphNode } from "../src/pages/shop/shop-canvas-graph";

test("connections reject self, missing, duplicate and multi-hop cycles without mutating nodes", () => {
    const nodes: CommerceGraphNode[] = [
        { id: "image", type: "image", resourceId: "product" },
        { id: "edit", type: "draft", inputs: ["image"] },
        { id: "output", type: "draft", inputs: ["edit"] },
    ];
    for (const [source, target] of [
        ["image", "image"],
        ["missing", "edit"],
        ["image", "edit"],
        ["output", "image"],
    ]) {
        const result = connectCommerceNodes(nodes, source, target);
        expect(result.error).toBeTruthy();
        expect(result.nodes).toBe(nodes);
    }
    const result = connectCommerceNodes(nodes, "image", "output");
    expect(result.error).toBeUndefined();
    expect(result.nodes[2].inputs).toEqual(["edit", "image"]);
    expect(nodes[2].inputs).toEqual(["edit"]);
});

test("downstream gets real upstream media and text, deduplicated through unfinished nodes", () => {
    const nodes: CommerceGraphNode[] = [
        { id: "image", type: "image", resourceId: "product" },
        { id: "copy", type: "text", text: "保持商标" },
        { id: "pending", type: "draft", inputs: ["image", "copy"] },
        { id: "output", type: "draft", inputs: ["pending", "image", "deleted"] },
    ];
    expect(commerceNodeReferences(nodes, "output").map((n) => n.id)).toEqual(["image", "copy"]);
    nodes[2] = { ...nodes[2], type: "generation", resourceId: "finished" };
    expect(commerceNodeReferences(nodes, "output").map((n) => n.resourceId)).toEqual(["finished", "product"]);
});

test("malformed saved cycle does not recurse indefinitely", () => {
    expect(
        commerceNodeReferences(
            [
                { id: "a", type: "draft", inputs: ["b"] },
                { id: "b", type: "draft", inputs: ["a"] },
            ],
            "a",
        ),
    ).toEqual([]);
});

test("video generation uses the connected outputs and waits for unfinished inputs", () => {
    const nodes: CommerceGraphNode[] = [
        { id: "image", type: "image", resourceId: "product" },
        { id: "image-copy", type: "image", resourceId: "product" },
        { id: "copy", type: "text", text: "镜头贴近商品细节" },
        { id: "pending", type: "draft", inputs: ["image"] },
        { id: "video", type: "draft", inputs: ["image", "image-copy", "copy", "pending"] },
    ];
    const inputs = shopCanvasVideoInputs(nodes, "video");
    expect(inputs.text).toBe("镜头贴近商品细节");
    expect(inputs.references).toEqual([{ id: "image", kind: "image", resourceId: "product", name: "参考图" }]);
    expect(inputs.pending).toBe(true);

    nodes[3] = { ...nodes[3], type: "video", resourceId: "clip" };
    const ready = shopCanvasVideoInputs(nodes, "video");
    expect(ready.pending).toBe(false);
    expect(ready.references.map(({ kind, resourceId }) => [kind, resourceId])).toEqual([
        ["image", "product"],
        ["video", "clip"],
    ]);
});

test("changing linked inputs retains manual prompt and identifies only old linked images", () => {
    const old = JSON.stringify([
        ["product", "old-image", null],
        ["copy", null, "旧卖点"],
    ]);
    const next = [{ id: "new", type: "text", text: "新卖点" }];
    const merged = reconcileCommerceLinks(old, next, "保持材质\n旧卖点");
    expect(merged.text).toBe("保持材质\n新卖点");
    expect([...merged.previousResourceIds]).toEqual(["old-image"]);
    expect(merged.previousResourceIds.has("manual-upload")).toBe(false);
    expect(reconcileCommerceLinks(old, [], "保持材质\n旧卖点").text).toBe("保持材质");
    expect(reconcileCommerceLinks(old, next, "用户改写的卖点").text).toBe("用户改写的卖点\n新卖点");
    expect(reconcileCommerceLinks(undefined, next, "新卖点").text).toBe("新卖点");
    expect(reconcileCommerceLinks("broken", next, "手写要求").text).toBe("手写要求\n新卖点");
});
