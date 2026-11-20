import type { ReactElement } from "react";
import { Kbd } from "@/components/ui/base/kbd/kbd";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";

export function ShopCanvasTooltip({ title, detail, shortcut, children }: { title: string; detail?: string; shortcut?: string; children: ReactElement }) {
    return (
        <AntTooltip
            arrow={false}
            trigger={["hover", "focus"]}
            classNames={{ root: "sp-canvas-tooltip ms-scope", container: "sp-canvas-tooltip-surface" }}
            title={
                <span className="sp-canvas-tooltip-content">
                    <span>
                        <strong>{title}</strong>
                        {detail ? <small>{detail}</small> : null}
                    </span>
                    {shortcut ? <Kbd className="sp-canvas-keycap">{shortcut}</Kbd> : null}
                </span>
            }
        >
            {children}
        </AntTooltip>
    );
}
