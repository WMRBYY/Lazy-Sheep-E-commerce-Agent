import { ChevronUp, Maximize2, Minimize2, PenLine } from "lucide-react";
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type UIEvent } from "react";
import { createPortal } from "react-dom";

import { ShopMediaMode } from "./shop-media-mode";

const ComposerHost = createContext<HTMLDivElement | null>(null);
const RevealComposer = createContext<() => void>(() => undefined);

export const useRevealShopComposer = () => useContext(RevealComposer);

/** 两种媒体只替换编辑内容，定位、尺寸与展开状态由同一个外壳持有。 */
export function ShopCreationDock({ mode, children }: { mode: "image" | "video"; children: ReactNode }) {
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [compact, setCompact] = useState(false);
    const capsule = useRef<HTMLButtonElement>(null);
    const editorFocus = useRef(false);
    const capsuleFocus = useRef(false);
    const positions = useRef(new WeakMap<HTMLElement, number>());
    const reveal = useCallback(() => setCompact(false), []);
    useLayoutEffect(() => {
        setCompact(false);
        setExpanded(false);
    }, [mode]);
    useLayoutEffect(() => {
        if (compact && capsuleFocus.current) {
            capsuleFocus.current = false;
            capsule.current?.focus({ preventScroll: true });
        }
        if (!editorFocus.current) return;
        editorFocus.current = false;
        host?.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"], textarea')?.focus({ preventScroll: true });
    }, [compact, host]);

    const onScroll = (event: UIEvent<HTMLDivElement>) => {
        const scroller = event.target;
        if (!(scroller instanceof HTMLElement) || !scroller.matches("[data-shop-creation-scroll], .sim-video-results .ecv-results-scroll")) return;
        const position = scroller.scrollTop;
        const bottom = scroller.scrollHeight - scroller.clientHeight;
        const distance = Math.abs(position - (positions.current.get(scroller) ?? 0));
        if (bottom - position <= 12) {
            positions.current.set(scroller, position);
            reveal();
        } else if (!expanded && distance >= 24) {
            positions.current.set(scroller, position);
            capsuleFocus.current = Boolean(document.activeElement?.closest(".sim-composer-full, .sim-dock-head"));
            setCompact(true);
        }
    };

    return (
        <ComposerHost.Provider value={host}>
            <RevealComposer.Provider value={reveal}>
                <div className="sim-workspace ms-scope" data-media-mode={mode} data-dock-expanded={expanded || undefined} onScrollCapture={onScroll}>
                    {children}
                    <div className="sim-creation-dock" data-expanded={expanded || undefined} data-compact={compact || undefined}>
                        <div className="sim-dock-head" inert={compact} aria-hidden={compact}>
                            <ShopMediaMode value={mode} />
                        </div>
                        <div className="sim-composer-frame">
                            <div className="sim-composer-full" id="shop-creation-input" inert={compact} aria-hidden={compact}>
                                <div className="sim-composer-host" ref={setHost} />
                                <button type="button" className="sim-expand" aria-label={expanded ? "缩小输入框" : "放大输入框"} aria-pressed={expanded} title={expanded ? "缩小输入框" : "放大输入框"} onClick={() => setExpanded((value) => !value)}>
                                    {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                                </button>
                            </div>
                            <button
                                ref={capsule}
                                type="button"
                                className="sim-composer-capsule"
                                aria-expanded={false}
                                aria-controls="shop-creation-input"
                                inert={!compact}
                                onClick={() => {
                                    editorFocus.current = true;
                                    reveal();
                                }}
                            >
                                <PenLine size={17} />
                                <span>AI 输入框</span>
                                <ChevronUp size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </RevealComposer.Provider>
        </ComposerHost.Provider>
    );
}

export function ShopCreationPortal({ children }: { children: ReactNode }) {
    const host = useContext(ComposerHost);
    return host ? createPortal(<div className="sim-composer-content">{children}</div>, host) : null;
}

/** 提示词菜单脱离可滚动的编辑区，避免 @ 引用被紧凑外框裁掉。 */
export function ShopPromptPopup({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
    const host = useContext(ComposerHost);
    const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
    useLayoutEffect(() => {
        const element = anchor.current;
        if (!host || !element) return;
        const measure = () => {
            const rect = element.getBoundingClientRect();
            const width = Math.min(320, window.innerWidth - 24);
            const above = rect.top > window.innerHeight - rect.bottom;
            setPosition({
                width,
                left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
                ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
                maxHeight: Math.max(80, Math.min(260, (above ? rect.top : window.innerHeight - rect.bottom) - 20)),
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [anchor, host]);
    return host
        ? createPortal(
              <div className="sim-prompt-popup ms-scope" style={position}>
                  {children}
              </div>,
              document.body,
          )
        : children;
}
