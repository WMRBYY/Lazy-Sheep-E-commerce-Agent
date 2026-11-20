import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("拆层协议请求 PNG 并保留多图输出列表", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../plugin-packages/image-tools/manifest.json", import.meta.url), "utf8"));
    const provider = manifest.contributes.providers.find((item: { id: string }) => item.id === "image-tools-layer-decomposition");
    expect(provider.create.body.output_format).toBe("png");
    expect(provider.create.path).toBe("/bytedance/seedream-v5.0-pro/layer-decomposition");
    expect(provider.response.images).toEqual({ $ref: "response.data.outputs" });
    expect(manifest.version).toBe("1.0.1");
});
