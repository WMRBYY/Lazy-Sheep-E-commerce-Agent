// Copyright (c) 2026 meiyeai and upstream contributors. Licensed under MIT.
/** 界面文案字段保存 i18n 键；公开版使用无业务数据的本地演示素材。 */
export const chapters = [
    { id: "opening", label: "序幕", title: "MeiyeAI", subtitle: "让一个故事，从文字走向银幕。", description: "面向 AI 影视与短剧创作的开源工作台。" },
    { id: "story", label: "故事", title: "一念，成故事。" },
    { id: "world", label: "角色", title: "让想象，有了面孔。" },
    { id: "shots", label: "分镜", title: "字里行间，皆是镜头。" },
    { id: "motion", label: "生成", title: "这一刻，动起来。" },
    { id: "canvas", label: "画布", title: "一个世界，一张画布。" },
] as const;

export type WelcomeLook = {
    id: string;
    label: string;
    title: string;
    frames: string[];
    screenplay: string[];
    video?: string;
    credit?: string;
};

const publicCaptions = ["创建你的项目", "上传自己的素材", "整理商品信息", "选择图片比例", "连接参考素材", "填写创作要求", "选择自己的模型", "查看生成状态", "预览作品", "整理画布", "保存项目", "导出自己的作品"];
const screenplayKeys = (_look: string) => [...publicCaptions];
const reelFrames = (_folder: string, _names: string[]) => Array.from({ length: 12 }, () => "/welcome/public-placeholder.svg");

export const welcomeLooks: WelcomeLook[] = [
    {
        id: "spring", label: "account.welcome.looks.spring.label", title: "account.welcome.looks.spring.title",
        frames: reelFrames("spring", ["1807", "1669", "4336", "3191", "3250"]),
        screenplay: screenplayKeys("spring"),
        credit: "meiyeai · MIT",
    },
    {
        id: "charge", label: "account.welcome.looks.charge.label", title: "account.welcome.looks.charge.title",
        frames: reelFrames("charge", ["factory-final", "einar", "robot", "character-final", "factory"]),
        screenplay: screenplayKeys("charge"),
        credit: "meiyeai · MIT",
    },
    {
        id: "wing-it", label: "account.welcome.looks.wingIt.label", title: "account.welcome.looks.wingIt.title",
        frames: reelFrames("wing-it", ["banner", "pitch", "sky-01", "barn", "sky-04", "sky-06"]),
        screenplay: screenplayKeys("wingIt"),
        credit: "meiyeai · MIT",
    },
];

export function getWelcomeLook(search = window.location.search) {
    const id = new URLSearchParams(search).get("look");
    return welcomeLooks.find((look) => look.id === id) ?? welcomeLooks[0];
}

export const showcases = [
    { name: "account.welcome.showcases.canvas.name", image: "/welcome/public-placeholder.svg", description: "account.welcome.showcases.canvas.description", detail: "account.welcome.showcases.canvas.detail", href: "/canvas" },
    { name: "account.welcome.showcases.create.name", image: "/welcome/public-placeholder.svg", description: "account.welcome.showcases.create.description", detail: "account.welcome.showcases.create.detail", href: "/create" },
    { name: "account.welcome.showcases.projects.name", image: "/welcome/public-placeholder.svg", description: "account.welcome.showcases.projects.description", detail: "account.welcome.showcases.projects.detail", href: "/projects" },
] as const;
