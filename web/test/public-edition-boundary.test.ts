import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");

test("private storefront features have no pages, preloads or API implementation", () => {
    for (const path of ["pages/shop/shop-video.tsx", "pages/shop/shop-script.tsx", "pages/shop/script", "pages/ecommerce/video", "services/api/video-replication.ts", "services/api/viral-plan.ts", "lib/canvas/canvas-video-remake.ts", "lib/prompts/video-remake.ts", "pages/shop/shop-covers-studio.tsx", "services/api/system-update.ts", "services/api/admin-skills.ts", "services/api/admin-agent-lessons.ts"]) {
        expect(existsSync(resolve(import.meta.dir, "../src", path))).toBe(false);
    }
    const preload = source("pages/shop/shop-preload.ts");
    expect(preload).not.toContain('import("./shop-video")');
    expect(preload).not.toContain('import("./shop-script")');
    const rail = source("components/mode/mode-rail.tsx");
    expect(rail).toContain('label: "视频复刻", icon: "video", to: "", disabled: true');
    expect(rail).toContain('label: "剧本创作", icon: "script", to: "", disabled: true');
    expect(rail).toContain("if (item.disabled)");
    const home = source("pages/shop/shop-home.tsx");
    expect(home).not.toMatch(/灵犀中枢|script-brain|视频复刻|深度复刻|剧本创作/);
    expect(home).toContain('/shop/image?media=video');
});

test("ordinary image, video and canvas workflows remain available", () => {
    expect(source("pages/shop/shop-image-video.tsx")).toContain("ShopVideoGeneration");
    expect(source("pages/shop/shop-canvas.tsx")).toContain("ShopCanvasVideoGeneration");
    expect(source("pages/shop/shop-preload.ts")).toContain('import("./shop-detail")');
    expect(source("router.tsx")).toContain('path: "payments"');
    expect(source("router.tsx")).toContain('path: "users"');
});
