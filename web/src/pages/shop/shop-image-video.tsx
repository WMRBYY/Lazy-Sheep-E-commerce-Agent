// Copyright (c) 2026 meiyeai. MIT licensed.
import { useLocation, useNavigate } from "react-router";
import { useUserStore } from "@/stores/use-user-store";
import { ShopVideoGeneration } from "./shop-video-generation";
import type { ShopMediaNavigationState } from "./shop-media-mode";
export function ShopImageVideo({ active }: { active: boolean }) {
    const scope = useUserStore((s) => s.user?.id);
    const location = useLocation();
    const navigate = useNavigate();
    const incoming = location.state as ShopMediaNavigationState | null;
    return (
        <ShopVideoGeneration
            key={scope}
            active={active}
            kindPicker={null}
            draft={active && incoming?.videoDraftOwner === scope ? incoming?.videoDraft : undefined}
            onDraftHandled={() => {
                const remaining = { ...incoming };
                delete remaining.videoDraft;
                delete remaining.videoDraftOwner;
                navigate(location.pathname + location.search, { replace: true, state: remaining });
            }}
        />
    );
}
