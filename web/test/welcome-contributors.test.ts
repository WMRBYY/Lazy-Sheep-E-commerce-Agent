import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseContributors } from "../src/pages/welcome/contributors-parse";

const identityAvatar = (path: string) => path;

test("public README retains attribution without a personal contact directory", () => {
    const readme = readFileSync(resolve(import.meta.dir, "../../README.md"), "utf8");
    expect(readme).toContain("meiyeai");
    expect(readme).toContain("Open AI Canvas");
    expect(readme).toContain("LICENSE");
    expect(parseContributors(readme, identityAvatar)).toEqual([]);
});

test("welcome contributors parse a synthetic HTML table", () => {
    const readme = `## 贡献者与团队
<table><tr><td><img src="assets/example.svg" alt="Example"><strong>Example</strong><a href="mailto:author@example.com">author@example.com</a><em>Example contribution</em></td></tr></table>`;
    const people = parseContributors(readme, identityAvatar);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: "Example", avatar: "assets/example.svg", email: "author@example.com" });
});

test("welcome contributors still parse markdown pipe tables", () => {
    const markdown = `## 贡献者与团队

| 头像 | 昵称 | 邮箱 | 签名 |
| --- | --- | --- | --- |
| <img src="assets/user-example.jpg" alt="Example"> | Example<br>项目发起者 · 微信：example-id | founder@example.com | 把故事搬上银幕 |
| <img src="assets/user-ken.jpg" alt="ken"> | ken | ken@example.com | 走自己的路 |

## 下一章
`;
    expect(parseContributors(markdown, identityAvatar)).toEqual([
        { name: "Example", avatar: "assets/user-example.jpg", signature: "把故事搬上银幕", email: "founder@example.com", wechat: "example-id", isFounder: true },
        { name: "ken", avatar: "assets/user-ken.jpg", signature: "走自己的路", email: "ken@example.com", wechat: undefined, isFounder: false },
    ]);
});
