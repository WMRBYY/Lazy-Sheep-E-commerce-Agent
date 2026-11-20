import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useEffect, useMemo, useState } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { createClientUUID } from "@/lib/client-id";
import { assertCurrentUserSession, captureUserSession, type UserSessionSnapshot } from "@/lib/user-scope";
import { creationImageAsset } from "@/pages/create/creation-assets";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { upsertRemoteAsset } from "@/services/api/user-data";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const CATEGORY_LABELS: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

export type PickedWorkbenchAsset = { resourceId: string; kind: "image" | "video" | "audio"; name: string };

type MediaKind = PickedWorkbenchAsset["kind"];
const MEDIA_LABELS: Record<MediaKind, string> = { image: "图片", video: "视频", audio: "音频" };

function disabledReason(asset: Asset, accept: readonly MediaKind[]) {
    if ((asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") && accept.includes(asset.kind)) return undefined;
    return `这里只能使用${accept.map((kind) => MEDIA_LABELS[kind]).join("、")}`;
}

/**
 * 选中素材对应的服务端资源。已同步的素材直接复用资源 ID；只在本机的图片先上传，
 * 没有真正落到服务端时报错，不把本机缓存当成可提交的参考素材。视频、音频必须已同步。
 */
async function pickedResource(item: AssetLibraryPickerItem, session: UserSessionSnapshot): Promise<PickedWorkbenchAsset> {
    const asset = item.asset;
    if (!asset || (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")) throw new Error(`“${item.title}”不能作为参考素材`);
    const direct = resourceIdFromStorageKey(asset.data.storageKey);
    if (direct) return { resourceId: direct, kind: asset.kind, name: item.title };
    if (asset.kind !== "image") throw new Error(`“${item.title}”还没有同步到服务器，请稍后再试`);
    const blob = asset.data.storageKey ? await getImageBlob(asset.data.storageKey) : null;
    const source = blob || asset.data.dataUrl || asset.coverUrl;
    if (!source) throw new Error(`“${item.title}”的图片文件已不存在`);
    assertCurrentUserSession(session);
    const uploaded = await uploadImage(source);
    const id = resourceIdFromStorageKey(uploaded.storageKey);
    if (uploaded.pendingRemoteUpload || !id) throw new Error(`“${item.title}”没能上传到服务器${uploaded.remoteUploadError ? `：${uploaded.remoteUploadError}` : ""}，请稍后重试`);
    return { resourceId: id, kind: "image", name: item.title };
}

export function WorkbenchAssetPicker({
    open,
    accept,
    remoteKind,
    maxCount,
    slotName,
    allowUpload,
    maxImageBytes,
    onClose,
    onPick,
}: {
    open: boolean;
    accept: readonly MediaKind[];
    remoteKind?: MediaKind;
    maxCount: number;
    slotName?: string;
    /** 在只接受图片的参考位开放本地上传。 */
    allowUpload?: boolean;
    maxImageBytes?: number;
    onClose: () => void;
    onPick: (assets: PickedWorkbenchAsset[]) => void;
}) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const assets = useAssetStore((state) => state.assets);
    const onlyKind = accept.length === 1 ? accept[0] : undefined;
    const requestedKind = remoteKind ?? onlyKind;
    const imageUploadEnabled = allowUpload && onlyKind === "image";
    const [uploadedAssets, setUploadedAssets] = useState<Asset[]>([]);
    useEffect(() => {
        if (!open) setUploadedAssets([]);
    }, [open]);
    const items = useMemo<AssetLibraryPickerItem[]>(
        () =>
            Array.from(new Map([...assets, ...uploadedAssets].map((asset) => [asset.id, asset])).values())
                .filter((asset) => (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") && (!(allowUpload || requestedKind) || accept.includes(asset.kind)))
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: normalizeAssetCategory(asset.category),
                    archived: asset.status === "archived",
                    kindLabel: asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片",
                    asset,
                    searchText: (asset.tags || []).join(" "),
                    disabledReason: disabledReason(asset, accept),
                })),
        [accept, allowUpload, assets, requestedKind, uploadedAssets],
    );
    const mediaLabel = accept.map((kind) => MEDIA_LABELS[kind]).join("、");
    const upload = async (files: FileList) => {
        const session = captureUserSession();
        if (session.userId === "guest") throw new Error("请先登录后上传素材");
        if (files.length > maxCount) throw new Error(`最多可上传 ${maxCount} 个素材，请减少文件数量后重试`);
        const settled = await Promise.allSettled(
            Array.from(files, async (file) => {
                if (!file.type.startsWith("image/") || !file.size) throw new Error("请选择可读取的图片");
                if (maxImageBytes && file.size > maxImageBytes) throw new Error(`图片超过 ${maxImageBytes / (1024 * 1024)} MB，请压缩后重试`);
                const uploaded = await uploadImage(file);
                assertCurrentUserSession(session);
                const resourceId = resourceIdFromStorageKey(uploaded.storageKey);
                if (uploaded.pendingRemoteUpload || !resourceId) throw new Error(uploaded.remoteUploadError || "文件尚未保存到服务器，请重试");
                const newAsset = creationImageAsset({ title: file.name, uploaded: { ...uploaded, url: resourceFileUrl(resourceId) }, metadata: { source: "reference-upload", fileName: file.name } });
                const now = new Date().toISOString();
                const asset: Asset = { ...newAsset, id: createClientUUID(), source: "参考素材", createdAt: now, updatedAt: now };
                await upsertRemoteAsset(asset);
                return asset;
            }),
        );
        assertCurrentUserSession(session);
        const added = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
        const failures = settled.flatMap((entry, index) => (entry.status === "rejected" ? [`${files[index].name}：${entry.reason instanceof Error ? entry.reason.message : "上传失败，请重试"}`] : []));
        if (!added.length) throw new Error(failures.join("；"));
        if (failures.length) message.warning(failures.join("；"));
        setUploadedAssets((current) => [...added, ...current]);
        void queryClient.invalidateQueries({ queryKey: ["asset-picker"] });
        void queryClient.invalidateQueries({ queryKey: ["asset-library"] });
        return added.map((asset) => asset.id);
    };
    return (
        <AssetLibraryPickerModal
            remoteLibrary
            acceptRemoteItems
            remoteKind={requestedKind}
            remoteItemDisabledReason={(asset) => disabledReason(asset, accept)}
            mediaKinds={[...accept]}
            multiple={maxCount > 1}
            open={open}
            items={items}
            categoryLabels={CATEGORY_LABELS}
            title={allowUpload ? "素材库" : slotName ? `从素材库选择「${slotName}」` : "从素材库选择参考素材"}
            eyebrow={allowUpload ? slotName || "参考内容" : "商品素材"}
            confirmLabel={(count) => (count ? `使用 ${count} 个素材` : "使用所选素材")}
            emptyDescription={allowUpload ? `上传${mediaLabel}后即可在这里选用。` : onlyKind ? `素材库暂无可用${mediaLabel}，也可以从本地上传。` : "素材库暂无可用素材，也可以从本地上传。"}
            footerNote={maxCount > 1 ? (allowUpload ? `最多再选 ${maxCount} 个素材` : `最多再选 ${maxCount} 个，超出部分不会添加`) : "选择一个素材"}
            upload={imageUploadEnabled && maxCount > 0 ? { accept: "image/*", description: "支持图片，上传后保存到素材库", onUpload: upload } : undefined}
            onClose={onClose}
            onConfirm={async (ids, pickedItems) => {
                const session = captureUserSession();
                const pool = new Map([...items, ...(pickedItems || [])].map((item) => [item.id, item]));
                if (ids.length > maxCount) throw new Error(maxCount ? `最多再选 ${maxCount} 个素材` : "这类参考素材已满，请先移除已有素材");
                const chosen = ids.map((id) => pool.get(id)).filter((item): item is AssetLibraryPickerItem => Boolean(item));
                if (!chosen.length) throw new Error("请选择素材");
                const resolved = await Promise.all(chosen.map((item) => pickedResource(item, session)));
                assertCurrentUserSession(session);
                if (resolved.some((item) => !accept.includes(item.kind))) throw new Error(`请选择${mediaLabel}素材`);
                onPick(resolved);
                onClose();
            }}
        />
    );
}
