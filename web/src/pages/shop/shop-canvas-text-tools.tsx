import { AlignCenter, AlignLeft, AlignRight, Check, ChevronDown, Download, Italic, Pencil } from "lucide-react";
import { Select } from "@/components/ui/base/select";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import "./shop-canvas-fonts.css";
import { ShopCanvasTooltip } from "./shop-canvas-tooltip";
import { ShopNodeToolbar } from "./shop-node-toolbar";

const FONT_FAMILIES = [
    { value: "sans-serif", label: "系统黑体" },
    { value: "Commerce Sans", label: "霞鹜文楷" },
    { value: "Commerce Serif", label: "思源宋体" },
];
const FONT_WEIGHTS = [
    { value: 400, label: "常规" },
    { value: 600, label: "中粗" },
    { value: 700, label: "粗体" },
];
const SELECT_CLASSES = {
    root: "sp-text-select",
    popup: { root: "sp-text-select-popup ms-scope", listItem: "sp-text-select-option" },
};

export function ShopCanvasTextTools({ layer, onChange, onEdit }: { layer: CanvasLayer; onChange: (patch: Partial<CanvasLayer>) => void; onEdit: () => void }) {
    const download = () => {
        const url = URL.createObjectURL(new Blob([layer.text || ""], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "画布文案.txt";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
        <ShopNodeToolbar className="sp-text-tools" label="文案格式">
            <ShopCanvasTooltip title="编辑文案">
                <button type="button" className="sp-text-tool-button" aria-label="编辑文案" onClick={onEdit}>
                    <Pencil size={17} />
                </button>
            </ShopCanvasTooltip>
            <Select<string>
                ariaLabel="字体"
                className="sp-text-family"
                classNames={SELECT_CLASSES}
                popupMatchSelectWidth={156}
                options={FONT_FAMILIES}
                value={layer.fontFamily || "sans-serif"}
                onChange={(fontFamily) => onChange({ fontFamily })}
                suffixIcon={<ChevronDown size={14} />}
                menuItemSelectedIcon={<Check size={16} />}
                showSearch={false}
                virtual={false}
            />
            <Select<number>
                ariaLabel="字重"
                className="sp-text-weight"
                classNames={SELECT_CLASSES}
                popupMatchSelectWidth={112}
                options={FONT_WEIGHTS}
                value={layer.fontWeight || 400}
                onChange={(fontWeight) => onChange({ fontWeight })}
                suffixIcon={<ChevronDown size={14} />}
                menuItemSelectedIcon={<Check size={16} />}
                optionRender={(option) => <span style={{ fontWeight: Number(option.value) }}>{option.label}</span>}
                showSearch={false}
                virtual={false}
            />
            <input aria-label="字号" title="字号" type="number" min={8} max={160} value={layer.fontSize || 24} onChange={(e) => onChange({ fontSize: Math.max(8, Math.min(160, Number(e.target.value))) })} />
            <ShopCanvasTooltip title="斜体">
                <button type="button" className="sp-text-tool-button" aria-label="斜体" aria-pressed={layer.italic || false} onClick={() => onChange({ italic: !layer.italic })}>
                    <Italic size={17} />
                </button>
            </ShopCanvasTooltip>
            <input type="color" aria-label="文字颜色" title="文字颜色" value={layer.color?.startsWith("#") ? layer.color : "#333333"} onChange={(e) => onChange({ color: e.target.value })} />
            <div className="sp-text-align" role="group" aria-label="对齐方式">
                {(["left", "center", "right"] as const).map((align, index) => {
                    const Icon = [AlignLeft, AlignCenter, AlignRight][index];
                    const label = ["左对齐", "居中", "右对齐"][index];
                    return (
                        <ShopCanvasTooltip key={align} title={label}>
                            <button type="button" className="sp-text-tool-button" aria-label={label} aria-pressed={(layer.textAlign || "left") === align} onClick={() => onChange({ textAlign: align })}>
                                <Icon size={17} />
                            </button>
                        </ShopCanvasTooltip>
                    );
                })}
            </div>
            <label title="字间距">
                字距
                <input aria-label="字间距" type="number" min={0} max={20} value={layer.letterSpacing || 0} onChange={(e) => onChange({ letterSpacing: Math.max(0, Math.min(20, Number(e.target.value))) })} />
            </label>
            <label title="行间距">
                行距
                <input aria-label="行间距" type="number" min={1} max={3} step={0.1} value={layer.lineHeight || 1.6} onChange={(e) => onChange({ lineHeight: Math.max(1, Math.min(3, Number(e.target.value))) })} />
            </label>
            <ShopCanvasTooltip title="下载文案">
                <button type="button" className="sp-text-tool-button" aria-label="下载文案" onClick={download}>
                    <Download size={17} />
                </button>
            </ShopCanvasTooltip>
        </ShopNodeToolbar>
    );
}
