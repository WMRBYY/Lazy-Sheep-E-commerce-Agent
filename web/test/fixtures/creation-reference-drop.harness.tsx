import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps, ReactNode } from "react";

const dom = new Window({ url: "http://localhost/create" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CreationComposer } = await import("../../src/pages/create/creation-workspace");
const { defaultConfig } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { CREATION_IMAGE_DRAG_TYPE } = await import("../../src/pages/create/creation-reference-drop");
const { buildCreationMentionReferences } = await import("../../src/pages/create/creation-references");
const { canvasResourceMentionToken } = await import("../../src/lib/canvas/canvas-resource-references");
const { useCreationImageDropOverlay } = await import("../../src/pages/create/use-creation-image-drop-overlay");
afterAll(() => dom.happyDOM.abort());

function DropSurface({ children, onDrop }: { children?: ReactNode; onDrop?: () => void }) {
    const { draggingImages, imageDropOverlayHandlers } = useCreationImageDropOverlay();
    return (
        <div data-drop-surface {...imageDropOverlayHandlers} onDrop={onDrop}>
            {draggingImages ? <div data-drop-overlay /> : null}
            {children}
        </div>
    );
}

const fire = async (target: EventTarget, type: string, transfer: unknown, extra: Record<string, unknown> = {}) => {
    const event = new dom.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ dataTransfer: transfer, ...extra })) Object.defineProperty(event, key, { value });
    await act(async () => target.dispatchEvent(event as unknown as Event));
    return event.defaultPrevented;
};

test("文件与生成图片拖到编辑区均追加；标签替换只消费一次；忙碌时不接收", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const drops: unknown[] = [],
        replacements: unknown[] = [];
    const noop = () => {};
    const capability = defaultModelCapabilityConfig();
    const props: ComponentProps<typeof CreationComposer> = {
        variant: "thread",
        mode: "image",
        prompt: "",
        setPrompt: noop,
        busy: false,
        generationActive: false,
        referenceReplacementBusy: false,
        referenceDropBusy: false,
        onReferenceDrop: (drop) => drops.push(drop),
        attachments: [],
        maxReferences: 3,
        references: [],
        onRemoveAttachment: noop,
        onClearAttachments: noop,
        onClearComposer: noop,
        onReorderAttachments: noop,
        onReplaceAttachment: noop,
        onReplaceReferenceFiles: (...args) => replacements.push(args),
        onOpenLibrary: noop,
        onModeChange: noop,
        model: "",
        modelRequirements: {},
        videoProfile: capability.video!,
        imageProfile: capability.image!,
        config: defaultConfig,
        onModelChange: noop,
        ratio: "1:1",
        setRatio: noop,
        seconds: "5",
        setSeconds: noop,
        quality: "auto",
        setQuality: noop,
        imageResolution: "auto",
        setImageResolution: noop,
        setImageParameters: noop,
        setTransparentBackground: noop,
        videoQuality: "720",
        setVideoQuality: noop,
        count: "1",
        setCount: noop,
        textStreaming: true,
        setTextStreaming: noop,
        textThinkingLevels: [],
        textThinkingLevel: "",
        textThinkingRequest: "auto",
        setTextThinkingLevel: noop,
        promptOptimizerProvider: null,
        composerFocusRef: { current: null },
        onPromptFocus: noop,
        onSubmit: noop,
    };
    const file = new File(["png"], "reference.png", { type: "image/png" });
    const transfer = { types: ["Files"], files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }], getData: () => "", dropEffect: "none" };
    let pageDrops = 0;
    const renderComposer = (overrides: Partial<typeof props> = {}) =>
        act(async () =>
            root.render(
                <DropSurface onDrop={() => pageDrops++}>
                    <CreationComposer {...props} {...overrides} />
                </DropSurface>,
            ),
        );
    try {
        await renderComposer();
        const surface = host.querySelector("[data-drop-surface]")!;
        const overlay = () => host.querySelector("[data-drop-overlay]");
        const editor = host.querySelector("textarea, [contenteditable]")!;
        await fire(surface, "dragover", transfer);
        expect(overlay()).not.toBeNull();
        expect(await fire(editor, "dragover", transfer)).toBe(true);
        expect(host.textContent).toContain("松开添加参考图");
        expect(overlay()).toBeNull();
        // Reproduce the stale page overlay even when the final dragover was
        // outside the composer and its drop never bubbles to the page.
        await fire(surface, "dragover", transfer);
        expect(overlay()).not.toBeNull();
        expect(await fire(editor, "drop", transfer)).toBe(true);
        expect(overlay()).toBeNull();
        expect(pageDrops).toBe(0);
        expect(drops).toEqual([{ kind: "files", files: [file] }]);
        await fire(editor, "drop", { types: [CREATION_IMAGE_DRAG_TYPE], files: [], items: [], getData: () => JSON.stringify({ messageId: "done", resultKey: "resource:image" }) });
        expect(drops[1]).toEqual({ kind: "result", image: { messageId: "done", resultKey: "resource:image" } });
        const attachment = { id: "image", name: "old.png", type: "image/png", dataUrl: "/old.png", previewUrl: "/old.png" };
        const references = buildCreationMentionReferences([], [attachment]);
        await renderComposer({ attachments: [attachment], references, prompt: canvasResourceMentionToken(references[0]) });
        const chip = host.querySelector("[data-mention-reference-id]")!;
        expect(chip).not.toBeNull();
        await fire(surface, "dragover", transfer);
        await fire(chip, "drop", transfer);
        expect(overlay()).toBeNull();
        expect(replacements).toHaveLength(1);
        expect(drops).toHaveLength(2);
        await renderComposer({ referenceDropBusy: true });
        await fire(host.querySelector(".creation-chat-composer")!, "drop", transfer);
        expect(drops).toHaveLength(2);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("遮罩在正常落下、页面外落下与取消时退出，持续拖动和内部移动保持提示", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let pageDrops = 0;
    const transfer = { types: ["Files"], dropEffect: "none" };
    const overlay = () => host.querySelector("[data-drop-overlay]");
    try {
        await act(async () =>
            root.render(
                <DropSurface onDrop={() => pageDrops++}>
                    <div data-child />
                </DropSurface>,
            ),
        );
        const surface = host.querySelector("[data-drop-surface]")!;
        const child = host.querySelector("[data-child]")!;
        Object.defineProperty(surface, "getBoundingClientRect", { value: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) });
        for (let index = 0; index < 5; index++) {
            await fire(surface, "dragover", transfer);
            await fire(surface, "dragleave", transfer, { relatedTarget: child, clientX: 50, clientY: 50 });
            expect(overlay()).not.toBeNull();
        }
        await fire(child, "drop", transfer);
        expect(overlay()).toBeNull();
        expect(pageDrops).toBe(1);
        const cancellations: Array<() => Promise<unknown>> = [
            () => fire(document.body, "drop", transfer),
            () => fire(child, "dragend", transfer),
            () => fire(document, "keydown", null, { key: "Escape" }),
            () => fire(window, "blur", null),
            () => fire(document, "pointermove", null, { buttons: 0 }),
            () => fire(document, "pointerdown", null),
            () => fire(surface, "dragleave", transfer, { relatedTarget: document.body }),
            () => fire(surface, "dragleave", transfer, { relatedTarget: null, clientX: 101, clientY: 50 }),
            () => fire(surface, "dragover", { types: ["text/plain"] }),
            async () => {
                Object.defineProperty(document, "hidden", { configurable: true, value: true });
                await fire(document, "visibilitychange", null);
                Object.defineProperty(document, "hidden", { configurable: true, value: false });
            },
        ];
        for (const cancel of cancellations) {
            await fire(surface, "dragover", transfer);
            expect(overlay()).not.toBeNull();
            await cancel();
            expect(overlay()).toBeNull();
        }
        expect(pageDrops).toBe(1);
        await fire(surface, "dragover", transfer);
        await fire(document, "keydown", null, { key: "Shift" });
        expect(overlay()).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
    // Route changes must release document/window listeners.
    await fire(document, "drop", transfer);
    await fire(window, "blur", null);
});
