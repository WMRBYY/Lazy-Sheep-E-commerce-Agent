import { ArrowUpRight, Workflow } from "lucide-react";
import { useState, type ReactNode } from "react";
import "./shop-workflow-card.css";

export function ShopWorkflowCard({ name, description, image, badge, onOpen }: { name: string; description?: string; image?: string; badge?: ReactNode; onOpen: () => void }) {
    const [unavailable, setUnavailable] = useState<string>();
    return (
        <button type="button" className="sp-workflow-card" onClick={onOpen}>
            <div className="sp-workflow-card-media">
                {image && unavailable !== image ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setUnavailable(image)} /> : <Workflow aria-hidden="true" size={32} />}
                {badge ? <div className="sp-workflow-card-badge">{badge}</div> : null}
            </div>
            <div className="sp-workflow-card-body">
                <strong>{name}</strong>
                <ArrowUpRight size={16} aria-hidden="true" />
                {description ? <small>{description}</small> : null}
            </div>
        </button>
    );
}
