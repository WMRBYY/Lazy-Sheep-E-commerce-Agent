import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { matchesShopTemplateDuration, SHOP_TEMPLATE_MIN_SECONDS, SHOP_VIDEO_TEMPLATES } from "../src/pages/shop/shop-template-catalog";

test("the public template gallery starts without the original video catalog or clips", () => {
    expect(SHOP_VIDEO_TEMPLATES).toEqual([]);
    expect(existsSync(resolve(import.meta.dir, "../public/shop-templates/edits/sources.json"))).toBe(false);
});

test("the long and short filters agree at the 15 second boundary", () => {
    expect(matchesShopTemplateDuration(SHOP_TEMPLATE_MIN_SECONDS, "long")).toBe(true);
    expect(matchesShopTemplateDuration(SHOP_TEMPLATE_MIN_SECONDS, "short")).toBe(false);
    expect(matchesShopTemplateDuration(SHOP_TEMPLATE_MIN_SECONDS - 1, "long")).toBe(false);
    expect(matchesShopTemplateDuration(SHOP_TEMPLATE_MIN_SECONDS - 1, "short")).toBe(true);
});
